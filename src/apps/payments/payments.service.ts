// api/src/apps/payments/payments.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'src/apps/prisma/prisma.service';
import Stripe from 'stripe';
import { FeeSetting, Prisma } from '@prisma/client';
import { CreatePaymentWithShareArgs } from 'src/shared/types';

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

  /**
   * プラン購読の Checkout Session 作成
   * - subscription モードでは payment_intent_data を渡せない（Stripe制約）
   * - platform 手数料は subscription_data.application_fee_percent で渡す
   * - transfer_data.destination で creator に送金
   */
  async createCheckoutForPlan(
    userId: string,
    creatorId: string,
    planId: string,
    successUrlIn?: string,
    cancelUrlIn?: string,
  ) {
    // ① creator の Stripe アカウントID
    const creator = await this.prisma.creator.findUnique({
      where: { userId: creatorId },
      select: { stripeAccountId: true },
    });

    if (!creator?.stripeAccountId) {
      throw new Error('クリエイターの Stripe アカウントが設定されていません');
    }

    // ② プラン情報
    const plan = await this.prisma.plan.findUnique({
      where: { id: planId },
      select: {
        id: true,
        creatorId: true,
        isActive: true,
        name: true,
        priceJpy: true,
        billingInterval: true, // 'month' | 'year' 想定
      },
    });

    if (!plan || !plan.isActive) {
      throw new Error('プランが存在しないか停止されています');
    }

    // 自分のプラン購読は禁止（creatorId と userId の整合は実装方針次第だがここは維持）
    if (plan.creatorId === userId) {
      throw new Error('自分自身のプランは購読できません');
    }

    // リクエストされた creatorId が plan.creatorId と一致するか
    if (creatorId !== plan.creatorId) {
      throw new Error('不正なクリエイターIDです');
    }

    if (!plan.priceJpy || plan.priceJpy <= 0) {
      throw new Error('プランの価格が正しく設定されていません');
    }

    // ③ success/cancel URL（呼び出し元が渡したらそれを優先）
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

    const successUrl = successUrlIn ?? `${appOrigin}/payments/success?session_id={CHECKOUT_SESSION_ID}&from=plan&planId=${plan.id}`;
    const cancelUrl  = cancelUrlIn  ?? `${appOrigin}/payments/cancel?from=plan&planId=${plan.id}`;

    // ④ Webhook 用 metadata
    const metadata = {
      userId,
      planId: plan.id,
      creatorId,
    };

    // ⑤ interval
    const interval: 'month' | 'year' =
      plan.billingInterval === 'year' ? 'year' : 'month';

    // ⑥ 手数料（platform取り分%）
    const feeSetting = await this.getFeeSetting();
    const platformPercent = (feeSetting.managerPercent ?? 0) + (feeSetting.shopPercent ?? 0);

    if (platformPercent < 0 || platformPercent > 100) {
      throw new Error(`FeeSetting percent invalid: platformPercent=${platformPercent}`);
    }

    // ⑦ Checkout Session 作成（subscription）
    // ✅ subscription では payment_intent_data を渡さない！！
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
        metadata, // subscription metadata
        application_fee_percent: platformPercent, // ← platformの取り分（%）
        transfer_data: {
          destination: creator.stripeAccountId, // ← creatorへ送金
        },
      },
      customer: await this.ensureStripeCustomer(userId),
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata, // session metadata（Webhook側で拾えるように）
    });

    this.logger.log(`[CheckoutSession] Created(subscription): ${session.id} planId=${plan.id}`);

    return { url: session.url };
  }


  /**
   * （オプション）PPV / 単品購入用 Checkout Session 作成
   * - Post の priceJpy を使って支払い
   * - metadata に userId / postId / creatorId を載せて Webhook 側で PostAccess 付与
   */
  async createCheckoutForPost(
    userId: string,
    postId: string,
    successUrlIn?: string,
    cancelUrlIn?: string,
  ) {
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
   * invoice.id を冪等キーとして Payment を作成
   * - webhook リトライでも二重作成されない
   */
  async ensurePaymentByInvoice(
    invoiceId: string,
    data: Prisma.PaymentCreateInput,
  ) {
    try {
      return await this.prisma.payment.create({
        data: {
          ...data,
          externalTxId: invoiceId,
        },
      });
    } catch (e: any) {
      // Unique violation (externalTxId)
      if (e?.code === 'P2002') {
        return await this.prisma.payment.findUnique({
          where: { externalTxId: invoiceId },
        });
      }
      throw e;
    }
  }

  async createPaymentWithShareIdempotent(
    externalTxId: string,
    build: () => Promise<Prisma.PaymentCreateInput>, // 必要なら同期でもOK
  ) {
    try {
      const data = await build();
      return await this.prisma.payment.create({
        data: { ...data, externalTxId },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        // externalTxId の unique で弾かれた = 既に作成済み
        return await this.prisma.payment.findUnique({ where: { externalTxId } });
      }
      throw e;
    }
  }  

  // Payment + 分配（Creator / Platform）を externalTxId で冪等に作成
  async createPaymentWithShareIdempotentV2(args: CreatePaymentWithShareArgs) {
    const {
      userId,
      creatorId,
      planId,
      postId,
      amountJpy,
      kind,
      externalTxId,
    } = args;

    return this.createPaymentWithShareIdempotent(externalTxId, async () => {
      const feeSetting = await this.getFeeSetting();
      const split = this.splitByFeeSetting(amountJpy, feeSetting);

      // PaymentCreateInput を「connect」ではなく “素のカラム” で作る（スキーマ差異に強い）
      // ※Payment モデルが userId/creatorId/planId/postId を持ってる前提
      return {
        userId,
        creatorId,
        planId: planId ?? undefined,
        postId: postId ?? undefined,
        amountJpy,
        kind,
        paymentStatus: 'paid',
        paidAt: new Date(),

        creatorAmountJpy: split.creatorAmountJpy,
        platformAmountJpy: split.managerAmountJpy + split.shopAmountJpy,

        managerPercent: feeSetting.managerPercent,
        shopPercent: feeSetting.shopPercent,
        creatorPercent: feeSetting.creatorPercent,
      } as Prisma.PaymentCreateInput;
    });
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
