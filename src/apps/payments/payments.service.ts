// api/src/apps/payments/payments.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'src/apps/prisma/prisma.service';
import Stripe from 'stripe';
import { FeeSetting } from '@prisma/client';

@Injectable()
export class PaymentsService {
  private readonly stripe: Stripe;
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    const secret =
      process.env.STRIPE_SECRET_KEY ||
      this.config.get<string>('stripeSecretKey');

    if (!secret) {
      throw new Error('STRIPE_SECRET_KEY is not set');
    }

    this.stripe = new Stripe(secret, {});
  }

// api/src/apps/payments/payments.service.ts

  /**
   * プラン購読の Checkout Session 作成
   * - Plan.priceJpy / billingInterval から price_data を組み立てる
   * - metadata に userId / planId / creatorId を載せて Webhook 側で利用
   */
  async createCheckoutForPlan(
    userId: string,
    creatorId: string,
    planId: string,
  ) {

    // creator の Stripe アカウントID を取得
    const creator = await this.prisma.creator.findUnique({
      where: { userId: creatorId },
      select: { stripeAccountId: true },
    });

    if (!creator?.stripeAccountId) {
      throw new Error('クリエイターの Stripe アカウントが設定されていません');
    }

    // プラン情報を取得（価格や名前も使う）
    const plan = await this.prisma.plan.findUnique({
      where: { id: planId },
      select: {
        id: true,
        creatorId: true,
        isActive: true,
        name: true,
        priceJpy: true,
        billingInterval: true,
      },
    });

    if (!plan || !plan.isActive) {
      throw new Error('プランが存在しないか停止されています');
    }

    // 自分のプラン購読は禁止
    if (plan.creatorId === userId) {
      throw new Error('自分自身のプランは購読できません');
    }

    // リクエストされた creatorId が DB のものと一致するか確認
    if (creatorId !== plan.creatorId) {
      throw new Error('不正なクリエイターIDです');
    }

    if (!plan.priceJpy || plan.priceJpy <= 0) {
      throw new Error('プランの価格が正しく設定されていません');
    }

    const appOrigin =
      this.config.get<string>('appOrigin') ??
      process.env.APP_ORIGIN ??
      'http://localhost:5173';

    const successPath =
      this.config.get<string>('stripeSuccessPath') ??
      process.env.STRIPE_SUCCESS_PATH ??
      '/mypage?purchase=success';

    const cancelPath =
      this.config.get<string>('stripeCancelPath') ??
      process.env.STRIPE_CANCEL_PATH ??
      '/mypage?purchase=cancel';

    const successUrl = `${appOrigin}${successPath}`;
    const cancelUrl = `${appOrigin}${cancelPath}`;

    // Webhook 側で使う metadata
    const metadata = {
      userId,
      planId: plan.id,
      creatorId,
    };

    // Prisma の enum BillingInterval -> Stripe の interval 文字列に変換
    const interval =
      plan.billingInterval === 'year' ? 'year' : 'month';

    const feeSetting = await this.getFeeSetting();

    // Subscription の税別金額に FeeSetting を反映
    const split = this.splitByFeeSetting(plan.priceJpy, feeSetting);
    const applicationFee = split.managerAmountJpy + split.shopAmountJpy;      

    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [
        {
          price_data: {
            currency: 'jpy',
            unit_amount: plan.priceJpy,
            recurring: { interval },
            product_data: { name: plan.name },
          },
          quantity: 1,
        },
      ],
      subscription_data: {
        metadata,
        application_fee_percent: undefined, // 使用しない
        transfer_data: {
          // 定期課金も自動でクリエイターへ送る
          destination: creator.stripeAccountId,
        },
      },
      payment_intent_data: {
        application_fee_amount: applicationFee,
        transfer_data: {
          destination: creator.stripeAccountId,
        },
      },
      customer: await this.ensureStripeCustomer(userId),
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata,
    });

    this.logger.log(`[CheckoutSession] Created: ${session.id}`);

    return { url: session.url };
  }


  /**
   * （オプション）PPV / 単品購入用 Checkout Session 作成
   * - Post の priceJpy を使って支払い
   * - metadata に userId / postId / creatorId を載せて Webhook 側で PostAccess 付与
   */
  async createCheckoutForPost(userId: string, postId: string) {
    const appOrigin =
      this.config.get<string>('appOrigin') ??
      process.env.APP_ORIGIN ??
      'http://localhost:5173';

    const successPath =
      this.config.get<string>('stripePpvSuccessPath') ??
      '/mypage?ppv=success';

    const cancelPath =
      this.config.get<string>('stripePpvCancelPath') ??
      '/mypage?ppv=cancel';

    const successUrl = `${appOrigin}${successPath}`;
    const cancelUrl = `${appOrigin}${cancelPath}`;

    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      include: {
        creator: {
          select: { stripeAccountId: true },
        },
      },
    });

    if (!post?.priceJpy) {
      throw new Error('この投稿は PPV 価格が設定されていません');
    }

    if (!post?.creator?.stripeAccountId) {
      throw new Error('クリエイターが Stripe Connect アカウントを設定していません');
    }

    // ★ FeeSetting に基づいて分配
    const feeSetting = await this.getFeeSetting();
    const split = this.splitByFeeSetting(post.priceJpy, feeSetting);

    const applicationFee = split.managerAmountJpy + split.shopAmountJpy;

    const metadata = {
      userId,
      postId: post.id,
      creatorId: post.creatorId,
    };

    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'jpy',
            unit_amount: post.priceJpy,
            product_data: { name: post.title },
          },
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer: await this.ensureStripeCustomer(userId),
      metadata,
      payment_intent_data: {
        metadata,
        application_fee_amount: applicationFee,
        transfer_data: {
          destination: post.creator.stripeAccountId,
        },
      },
    });

    return { url: session.url };
  }


  /**
   * プランID → Stripe Price ID を取得
   * - 現行スキーマの externalPriceId を使う
   */
  // private async getStripePriceId(planId: string): Promise<string> {
  //   const plan = await this.prisma.plan.findUnique({
  //     where: { id: planId },
  //     select: {
  //       externalPriceId: true,
  //     },
  //   });

  //   if (!plan) {
  //     this.logger.error(`Plan not found for planId=${planId}`);
  //     throw new Error('Plan not found.');
  //   }

  //   if (!plan.externalPriceId) {
  //     this.logger.error(
  //       `Stripe Price ID (externalPriceId) not set for planId=${planId}`,
  //     );
  //     throw new Error('Stripe Price ID is not set for this plan.');
  //   }

  //   return String(plan.externalPriceId);
  // }

  /**
   * ユーザーに Stripe Customer を割り当て（無ければ作成）
   * - user.stripeCustomerId / stripe_customer_id どちらにも対応
   * - カラムが存在しなければ undefined を返し、Checkout 側でメール収集
   */
  private async ensureStripeCustomer(
    userId: string,
  ): Promise<string | undefined> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        stripeCustomerId: true,
      },
    });

    if (!user) {
      this.logger.warn(`ensureStripeCustomer: user not found (id=${userId})`);
      return undefined;
    }

    if (user.stripeCustomerId) {
      return user.stripeCustomerId;
    }

    const customer = await this.stripe.customers.create({
      email: user.email ?? undefined,
      metadata: { userId },
    });

    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: { stripeCustomerId: customer.id },
      });
    } catch (e) {
      this.logger.error('Failed to save stripeCustomerId', e as any);
    }

    return customer.id;
  }


  /**
   * Payment + 分配（Creator / Platform）を作成する内部ヘルパー
   */
  async createPaymentWithShare(params) {
    const {
      userId,
      creatorId,
      planId,
      postId,
      amountJpy,
      kind,
      externalTxId,
    } = params;

    const feeSetting = await this.getFeeSetting();
    const split = this.splitByFeeSetting(amountJpy, feeSetting);

    return this.prisma.payment.create({
      data: {
        userId,
        creatorId,
        planId,
        postId,
        amountJpy,
        kind,
        externalTxId: externalTxId ?? null,
        paymentStatus: 'paid',
        paidAt: new Date(),

        // ★ FeeSetting 基準の取り分
        creatorAmountJpy: split.creatorAmountJpy,
        platformAmountJpy: split.managerAmountJpy + split.shopAmountJpy,

        managerPercent: feeSetting.managerPercent,
        shopPercent:    feeSetting.shopPercent,
        creatorPercent: feeSetting.creatorPercent,
      },
    });
  }

  /**
   * DB から現在の手数料設定を取得
   * 1 レコードしかない前提。なければデフォルト 20 / 10 / 70
   */
  private async getFeeSetting(): Promise<FeeSetting> {
    const fs = await this.prisma.feeSetting.findFirst();
    if (fs) return fs;

    // まだレコードが無い場合のフェイルセーフ
    return {
      id: 1,
      managerPercent: 20,
      shopPercent: 10,
      creatorPercent: 70,
      updatedAt: new Date(),
    } as FeeSetting;
  }

  /**
   * 合計金額を 手数料設定に応じて 3 つに分配する
   * 端数はクリエイター側に寄せる
   */
  private splitByFeeSetting(
    totalJpy: number,
    setting: FeeSetting,
  ) {
    const manager = Math.floor((totalJpy * setting.managerPercent) / 100);
    const shop = Math.floor((totalJpy * setting.shopPercent) / 100);

    // 端数はクリエイター側に寄せる
    const creator = totalJpy - manager - shop;

    return {
      managerAmountJpy: manager,
      shopAmountJpy: shop,
      creatorAmountJpy: creator,
    };
  }    
}
