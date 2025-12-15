// api/src/apps/payments/stripe-webhook.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import Stripe from 'stripe';
import { KycStatus, PaymentKind, PaymentStatus, SubStatus } from '@prisma/client';
import { PaymentsService } from './payments.service';

@Injectable()
export class StripeWebhookService {
  private readonly logger = new Logger(StripeWebhookService.name);
  private readonly stripe: Stripe;

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly config: ConfigService, // ✅ 追加
  ) {
    const secret =
      process.env.STRIPE_SECRET_KEY ||
      this.config.get<string>('stripeSecretKey');

    if (!secret) throw new Error('STRIPE_SECRET_KEY is not set');
    this.stripe = new Stripe(secret, {});
  }

  async processEvent(event: Stripe.Event) {
    // ★ event.id を冪等キーにして “入口で重複排除”
    const created = await this.tryCreateWebhookEvent(event);
    if (!created) {
      this.logger.log(`skip duplicate event: ${event.id} (${event.type})`);
      return; // 既に処理済み or 受領済み
    }

    try {
      switch (event.type) {
        case 'account.updated':
          await this.handleAccountUpdated(event.data.object as Stripe.Account);
          break;

        case 'checkout.session.completed':
          await this.handleCheckoutSessionCompleted(
            event.data.object as Stripe.Checkout.Session,
          );
          break;

        case 'customer.subscription.created':
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted':
          await this.handleSubscriptionUpdated(
            event.data.object as Stripe.Subscription,
          );
          break;

        case 'invoice.payment_succeeded':
          await this.handleInvoicePaymentSucceeded(
            event.data.object as Stripe.Invoice,
          );
          break;

        case 'payment_intent.succeeded':
          await this.handlePaymentIntentSucceeded(
            event.data.object as Stripe.PaymentIntent,
          );
          break;

        default:
          break;
      }

      await this.prisma.webhookEvent.update({
        where: { id: created.id },
        data: { processed: true, processedAt: new Date() },
      });
    } catch (e: any) {
      // processed=false のまま残す（運用で再処理もしやすい）
      this.logger.error(`event failed: ${event.id} (${event.type})`, e?.stack || e);
      throw e; // controller に戻して 5xx → Stripe がリトライ
    }
  }

    private async tryCreateWebhookEvent(event: Stripe.Event) {
    try {
      return await this.prisma.webhookEvent.create({
        data: {
          provider: 'stripe',
          eventType: event.type,
          idempotencyKey: event.id, // ★ここが肝
          payload: event as any,
          processed: false,
        },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        // 既に受領済み（または処理済み）
        return null;
      }
      throw e;
    }
  }  

  // ✅ Connect口座の状態を Creator に同期
  async handleAccountUpdated(account: Stripe.Account) {
    const stripeAccountId = account.id;

    const stripeChargesEnabled = !!account.charges_enabled;
    const stripePayoutsEnabled = !!account.payouts_enabled;

    const disabledReason = account.requirements?.disabled_reason ?? null;
    const currentlyDue = account.requirements?.currently_due ?? [];

    const stripeKycStatus: KycStatus =
      stripeChargesEnabled && stripePayoutsEnabled
        ? KycStatus.approved
        : KycStatus.pending;

    const result = await this.prisma.creator.updateMany({
      where: { stripeAccountId },
      data: {
        stripeChargesEnabled,
        stripePayoutsEnabled,
        stripeKycStatus,
        stripeKycDisabledReason: disabledReason,
        stripeKycFieldsDue: currentlyDue.join(','),
        updatedAt: new Date(),
      },
    });

    this.logger.log(
      `account.updated sync: acct=${stripeAccountId} updated=${result.count} charges=${stripeChargesEnabled} payouts=${stripePayoutsEnabled} kyc=${stripeKycStatus}`,
    );
  }

  // --- Checkout 完了（PPV / 初回決済） ---
  async handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
    const userId = session.metadata?.userId ?? null;
    const planId = session.metadata?.planId ?? null;
    const postId = session.metadata?.postId ?? null;

    if (!userId) {
      this.logger.warn(
        `checkout.session.completed without userId. session.id=${session.id}`,
      );
      return;
    }

    // PPV（単品）購入なら PostAccess を付与（保険）
    if (postId && !planId) {
      await this.prisma.postAccess.upsert({
        where: { userId_postId: { userId, postId } },
        update: { expiresAt: null },
        create: { userId, postId, expiresAt: null },
      });
    }

    this.logger.log(
      `checkout.session.completed handled. userId=${userId}, planId=${planId}, postId=${postId}`,
    );
  }

  // --- 定期課金の状態更新（作成 / 更新 / 解約） ---
  async handleSubscriptionUpdated(sub: Stripe.Subscription) {
    const userId = (sub.metadata?.userId ?? undefined) as string | undefined;
    const planId = (sub.metadata?.planId ?? undefined) as string | undefined;
    const subId = sub.id;

    let creatorId: string | undefined = (sub.metadata?.creatorId ??
      undefined) as string | undefined;

    if (!creatorId && planId) {
      const plan = await this.prisma.plan.findUnique({
        where: { id: planId },
        select: { creatorId: true },
      });
      creatorId = plan?.creatorId;
    }

    if (!userId || !planId || !creatorId) {
      this.logger.warn(
        `subscription.updated missing userId/planId/creatorId. sub.id=${sub.id}`,
      );
      return;
    }

    const statusMap: Partial<Record<Stripe.Subscription.Status, SubStatus>> = {
      active: SubStatus.active,
      trialing: SubStatus.trialing,
      past_due: SubStatus.past_due,
      canceled: SubStatus.canceled,
      incomplete: SubStatus.incomplete,
      unpaid: SubStatus.past_due,
      incomplete_expired: SubStatus.canceled,
    };

    const subStatus: SubStatus = statusMap[sub.status] ?? SubStatus.incomplete;

    const anySub = sub as any;
    const periodStartSec: number = anySub.current_period_start ?? 0;
    const periodEndSec: number = anySub.current_period_end ?? 0;
    const periodStart = new Date(periodStartSec * 1000);
    const periodEnd = new Date(periodEndSec * 1000);

    await this.prisma.subscription.upsert({
      where: { stripeSubscriptionId: subId },
      update: {
        userId,
        creatorId,
        planId,
        status: subStatus,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
      },
      create: {
        userId,
        creatorId,
        planId,
        stripeSubscriptionId: subId,
        status: subStatus,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
      },
    });

    this.logger.log(
      `subscription.updated handled. subId=${sub.id}, userId=${userId}, planId=${planId}, status=${subStatus}`,
    );
  }

  // ✅ 今回の修正点：Subscription未作成でもフォールバックしてPayment/Access付与まで通す
  async handleInvoicePaymentSucceeded(invoice: Stripe.Invoice) {
    const inv = invoice as any;
    const subscriptionId = inv.subscription as string | null;
    if (!subscriptionId) return;

    // 1) まずDBを探す（必要最小だけ）
    let dbSub = await this.prisma.subscription.findUnique({
      where: { stripeSubscriptionId: String(subscriptionId) },
      select: {
        userId: true,
        creatorId: true,
        planId: true,
      },
    });

    // 2) 無ければ Stripe から subscription を取得してDBに作る
    if (!dbSub) {
      this.logger.warn(
        `invoice.payment_succeeded: Subscription not found in DB. Fetching from Stripe... subId=${subscriptionId}`,
      );

      const sub = await this.stripe.subscriptions.retrieve(String(subscriptionId));

      const userId = (sub.metadata?.userId ?? undefined) as string | undefined;
      const planId = (sub.metadata?.planId ?? undefined) as string | undefined;

      let creatorId: string | undefined = (sub.metadata?.creatorId ??
        undefined) as string | undefined;

      // creatorId が無ければ Plan から補完
      if (!creatorId && planId) {
        const plan = await this.prisma.plan.findUnique({
          where: { id: planId },
          select: { creatorId: true },
        });
        creatorId = plan?.creatorId;
      }

      if (!userId || !planId || !creatorId) {
        this.logger.error(
          `invoice.payment_succeeded: cannot recover metadata. subId=${subscriptionId} userId=${userId} planId=${planId} creatorId=${creatorId}`,
        );
        return;
      }

      const statusMap: Partial<Record<Stripe.Subscription.Status, SubStatus>> = {
        active: SubStatus.active,
        trialing: SubStatus.trialing,
        past_due: SubStatus.past_due,
        canceled: SubStatus.canceled,
        incomplete: SubStatus.incomplete,
        unpaid: SubStatus.past_due,
        incomplete_expired: SubStatus.canceled,
      };
      const subStatus: SubStatus = statusMap[sub.status] ?? SubStatus.incomplete;

      const anySub = sub as any;
      const periodStartSec: number = anySub.current_period_start ?? 0;
      const periodEndSec: number = anySub.current_period_end ?? 0;

      const periodStart = new Date(periodStartSec * 1000);
      const periodEnd = new Date(periodEndSec * 1000);

      // ✅ upsert（同時到達でも安全）
      await this.prisma.subscription.upsert({
        where: { stripeSubscriptionId: sub.id },
        update: {
          userId,
          creatorId,
          planId,
          status: subStatus,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
        },
        create: {
          userId,
          creatorId,
          planId,
          stripeSubscriptionId: sub.id,
          status: subStatus,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
        },
      });

      // 取り直し（同じselectにする）
      dbSub = await this.prisma.subscription.findUnique({
        where: { stripeSubscriptionId: String(subscriptionId) },
        select: { userId: true, creatorId: true, planId: true },
      });

      if (!dbSub) {
        this.logger.error(
          `invoice.payment_succeeded: failed to create Subscription in DB. subId=${subscriptionId}`,
        );
        return;
      }
    }

    // 3) Payment 作成（重複防止：externalTxId を invoice.id で一意にするのが理想）
    const amountJpy =
      typeof invoice.amount_paid === 'number' ? invoice.amount_paid : 0;

    if (amountJpy) {
      await this.payments.createPaymentWithShareIdempotentV2({
        userId: dbSub.userId,
        creatorId: dbSub.creatorId,
        planId: dbSub.planId,
        postId: null,
        amountJpy,
        kind: 'subscription',
        externalTxId: invoice.id, // ★ここが冪等キー
      });
    } else {
      this.logger.warn(
        `invoice.payment_succeeded: amount_paid is 0. invoiceId=${invoice.id}`,
      );
    }

    // 4) plan投稿アクセス付与
    const posts = await this.prisma.post.findMany({
      where: {
        creatorId: dbSub.creatorId,
        visibility: 'plan',
        planId: dbSub.planId,
      },
      select: { id: true },
    });

    for (const p of posts) {
      await this.prisma.postAccess.upsert({
        where: {
          userId_postId: {
            userId: dbSub.userId,
            postId: p.id,
          },
        },
        create: {
          userId: dbSub.userId,
          postId: p.id,
          expiresAt: null,
        },
        update: {},
      });
    }

    this.logger.log(
      `invoice.payment_succeeded handled. invoiceId=${invoice.id} subId=${subscriptionId}`,
    );
  }

  async handlePaymentIntentSucceeded(pi: Stripe.PaymentIntent) {
    const m = pi.metadata || {};
    const userId = m.userId as string | undefined;
    const postId = m.postId as string | undefined;
    const creatorIdMeta = m.creatorId as string | undefined;

    if (!userId || !postId) {
      this.logger.warn(`PI succeeded but missing metadata. pi.id=${pi.id}`);
      return;
    }

    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      select: { id: true, creatorId: true },
    });
    if (!post) {
      this.logger.warn(`Post not found for PPV purchase: ${postId}`);
      return;
    }

    const amountJpy = typeof pi.amount_received === 'number' ? pi.amount_received : 0;
    if (!amountJpy) {
      this.logger.warn(`PI succeeded but amount_received is 0. pi.id=${pi.id}`);
      return;
    }

    const resolvedCreatorId = creatorIdMeta ?? post.creatorId ?? undefined;
    if (!resolvedCreatorId) {
      this.logger.warn(`PI succeeded but creatorId is missing. pi.id=${pi.id}`);
      return;
    }

    // ✅ Paymentは「分配込み＋externalTxId=pi.id」で冪等作成（existsチェック不要）
    await this.payments.createPaymentWithShareIdempotentV2({
      userId,
      creatorId: resolvedCreatorId,
      planId: null,
      postId,
      amountJpy,
      kind: 'one_time',
      externalTxId: pi.id,
    });

    // ✅ Accessは upsert なので何回走っても安全
    await this.prisma.postAccess.upsert({
      where: { userId_postId: { userId, postId } },
      create: { userId, postId, expiresAt: null },
      update: {},
    });

    this.logger.log(`PPV unlocked: user=${userId}, post=${postId} pi=${pi.id}`);
  }
}
