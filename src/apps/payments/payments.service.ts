import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'src/apps/prisma/prisma.service';
import Stripe from 'stripe';

@Injectable()
export class PaymentsService {
  private readonly stripe: Stripe;
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    const secret = process.env.STRIPE_SECRET_KEY || this.config.get<string>('stripeSecretKey');
    if (!secret) {
      throw new Error('STRIPE_SECRET_KEY is not set');
    }
    this.stripe = new Stripe(secret);
  }

  /**
   * Stripe Webhook 受信処理
   * - idempotency: webhookLog で重複登録を防止
   * - checkout.session.completed: 購読の active 化＋期間境界の反映
   */
  async handleWebhook(body: any, signature?: string) {
    // ここでは署名検証は呼び出し元で実施済み or 省略前提
    const evt = typeof body === 'string' ? JSON.parse(body) : body;

    // 既に処理済みならスキップ
    const exists = await this.prisma.webhookLog.findUnique({ where: { id: evt.id } });
    if (exists) return { ok: true, duplicated: true };

    await this.prisma.$transaction(async (tx) => {
      await tx.webhookLog.create({ data: { id: evt.id, type: evt.type } });

      if (evt.type === 'checkout.session.completed') {
        const s = evt.data.object as any;

        const userId = String(s.metadata?.userId ?? '');
        const planId = String(s.metadata?.planId ?? '');
        const externalSubId = s.subscription ? String(s.subscription) : null;

        if (!userId || !planId) {
          this.logger.warn(`checkout.session.completed: missing metadata userId/planId. metadata=${JSON.stringify(s.metadata)}`);
          return;
        }

        // --- 課金期間（current_period_start/end）を Stripe から取得（失敗時はフォールバック +30日） ---
        let periodStart = new Date();
        let periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // +30日

        if (externalSubId) {
          try {
            const subRes = await this.stripe.subscriptions.retrieve(externalSubId);
            const cps: number | undefined = (subRes as any)?.current_period_start;
            const cpe: number | undefined = (subRes as any)?.current_period_end;
            if (typeof cps === 'number') periodStart = new Date(cps * 1000);
            if (typeof cpe === 'number') periodEnd = new Date(cpe * 1000);
          } catch (e) {
            this.logger.warn(`Failed to retrieve subscription(${externalSubId}): ${String((e as Error).message)}`);
          }
        }

        // --- 既存購読の有無で upsert 的に処理 ---
        const existing = await tx.subscription.findFirst({
          where: { userId, planId },
        });

        if (existing) {
          await tx.subscription.update({
            where: { id: existing.id },
            data: {
              status: 'active',
              externalSubId,
              currentPeriodStart: periodStart,
              currentPeriodEnd: periodEnd,
              // cancelAtPeriodEnd: false,
            },
          });
        } else {
          await tx.subscription.create({
            data: {
              userId,
              planId,
              status: 'active',
              externalSubId,
              currentPeriodStart: periodStart,
              currentPeriodEnd: periodEnd,
            },
          });
        }

        // 決済レコード（任意：重複防止簡易版）
        try {
          const amountTotal: number | undefined = (s as any)?.amount_total;
          const currency: string | undefined = (s as any)?.currency ?? 'jpy';
          const paymentIntentId: string | undefined = (s as any)?.payment_intent;
          await tx.payment.create({
            data: {
              id: paymentIntentId ?? undefined, // 既に採番されるなら省略
              userId,
              amountJpy: typeof amountTotal === 'number' ? Math.floor(amountTotal) : undefined,
              currency,
              status: 'succeeded',
              kind: 'subscription',
              paidAt: new Date(),
            } as any,
          });
        } catch {
          // 決済レコード作成は任意のため失敗は握りつぶす
        }
      }
    });

    return { ok: true };
  }

  /**
   * プラン購読の Checkout Session 作成
   * - success/cancel URL は ENV or ConfigService から取得
   * - customer は ensureStripeCustomer で作成/再利用
   * - line_items.price はプランに紐づいた Stripe Price ID を使用
   */
  async createCheckoutForPlan(userId: string, creatorId: string, planId: string) {
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

    // プランに対応する Stripe Price ID を取得
    const priceId = await this.getStripePriceId(planId);

    // 任意: メタデータで userId / planId を保持（webhook用）
    const metadata = { userId, planId, creatorId };

    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer: await this.ensureStripeCustomer(userId),
      metadata,
      subscription_data: {
        metadata,
      },
    });

    this.logger.log(`[CheckoutSession] Created: ${session.url}`);
    return { url: session.url };
  }

  /**
   * プランID→Stripe Price ID を取得
   * - Prisma スキーマのカラム名差異に耐えるフォールバック実装
   */
  private async getStripePriceId(planId: string): Promise<string> {
    const plan: any = await this.prisma.plan.findUnique({
      where: { id: planId },
      select: {
        stripePriceId: true as any,
        stripe_price_id: true as any,
        priceId: true as any,
        price_id: true as any,
      } as any,
    });

    const priceId =
      plan?.stripePriceId ??
      plan?.stripe_price_id ??
      plan?.priceId ??
      plan?.price_id;

    if (!priceId) {
      this.logger.error(`Stripe Price ID not found for planId=${planId}`);
      throw new Error('Stripe Price ID is not set for this plan.');
    }
    return String(priceId);
  }

  /**
   * ユーザーに Stripe Customer を割り当て（無ければ作成）
   * - user.stripeCustomerId / stripe_customer_id どちらにも対応
   * - カラムが存在しなければ undefined を返し、Checkout 側でメール収集
   */
  private async ensureStripeCustomer(userId: string): Promise<string | undefined> {
    const user: any = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        stripeCustomerId: true as any,
        stripe_customer_id: true as any,
      } as any,
    });
    if (!user) {
      this.logger.warn(`ensureStripeCustomer: user not found (id=${userId})`);
      return undefined;
    }

    const current = user.stripeCustomerId ?? user.stripe_customer_id;
    if (current) return String(current);

    // なければ新規作成
    const customer = await this.stripe.customers.create({
      email: user.email ?? undefined,
      metadata: { userId },
    });

    // camelCase / snake_case どちらでも保存できるようトライ
    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: { stripeCustomerId: customer.id } as any,
      });
    } catch {
      await this.prisma.user.update({
        where: { id: userId },
        data: { stripe_customer_id: customer.id } as any,
      });
    }
    return customer.id;
  }
}
