// src/apps/payments/stripe-webhook.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import Stripe from 'stripe';
import { KycStatus, PaymentKind, PaymentStatus, SubStatus } from '@prisma/client';
import { PaymentsService } from './payments.service';

@Injectable()
export class StripeWebhookService {
  private readonly logger = new Logger(StripeWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
  ) {}

  async handleAccountUpdated(account: Stripe.Account) {
    const kyc = account.requirements;

    let status: KycStatus;

    // 1. 明確にリジェクトされているパターン
    if (kyc?.disabled_reason?.startsWith('rejected')) {
      status = KycStatus.rejected;  // フロントからもわかりやすい
    }
    // 2. disabled_reason なし & currently_due/past_due/eventually_due が全部空 → OK
    else if (
      kyc?.disabled_reason == null &&
      (kyc?.currently_due?.length ?? 0) === 0 &&
      (kyc?.past_due?.length ?? 0) === 0 &&
      (kyc?.eventually_due?.length ?? 0) === 0
    ) {
      status = KycStatus.approved;  // ★ フロントの isKycOk === 'verified' に合わせる
    }
    // 3. それ以外は pending
    else {
      status = KycStatus.pending;
    }

    await this.prisma.creator.updateMany({
      where: { stripeAccountId: account.id },
      data: {
        stripeKycStatus: status,
        stripeChargesEnabled: account.charges_enabled ?? false,
        stripePayoutsEnabled: account.payouts_enabled ?? false,
        stripeKycDisabledReason: kyc?.disabled_reason ?? null,
        stripeKycErrors: kyc?.errors ? JSON.stringify(kyc.errors) : null,
        stripeKycFieldsDue: kyc?.currently_due
          ? JSON.stringify(kyc.currently_due)
          : null,
      },
    });

    this.logger.log(
      `Stripe account ${account.id} KYC updated -> ${status}`,
    );
  }


  // --- Checkout 完了（PPV / 初回決済） ---
  async handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
    const userId = session.metadata?.userId ?? null;
    const planId = session.metadata?.planId ?? null;
    const postId = session.metadata?.postId ?? null;
    const creatorId = session.metadata?.creatorId ?? null;

    if (!userId) {
      this.logger.warn(
        `checkout.session.completed without userId. session.id=${session.id}`,
      );
      return;
    }

    const amountJpy = session.amount_total ?? 0; // JPY はそのまま円

    const kind: PaymentKind =
      planId != null ? PaymentKind.subscription : PaymentKind.one_time;

    const paymentStatus: PaymentStatus = PaymentStatus.paid;

    const externalTxId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.id;

    // ===== ここから分配ロジック =====
    // デフォルトは 80%:20%
    let creatorSharePercent = 80;

    // プラン課金なら Plan の設定値を優先
    if (planId) {
      const plan = await this.prisma.plan.findUnique({
        where: { id: planId },
        select: {
          creatorSharePercent: true,
          platformSharePercent: true,
        },
      });

      if (plan?.creatorSharePercent != null) {
        creatorSharePercent = plan.creatorSharePercent;
      }

      // ※ platformSharePercent は使わなくても良いが、
      //   異常値（合計が100でないなど）はログに出しておくと安心。
      const totalPercent =
        (plan?.creatorSharePercent ?? 0) +
        (plan?.platformSharePercent ?? 0);
      if (totalPercent !== 100) {
        this.logger.warn(
          `Plan share percent total != 100. planId=${planId}, total=${totalPercent}`,
        );
      }
    }

    // PPV（単品）購入なら PostAccess を付与
    if (postId && !planId) {
      await this.prisma.postAccess.upsert({
        where: {
          userId_postId: { userId, postId },
        },
        update: {
          expiresAt: null, // 期限を付けたい場合はここで設定
        },
        create: {
          userId,
          postId,
          expiresAt: null,
        },
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

    // creatorId は metadata か Plan から補完
    let creatorId: string | undefined = (sub.metadata?.creatorId ??
      undefined) as string | undefined;

    if (!creatorId && planId) {
      const plan = await this.prisma.plan.findUnique({
        where: { id: planId },
        select: { creatorId: true },
      });
      creatorId = plan?.creatorId; // string | undefined
    }

    if (!userId || !planId || !creatorId) {
      this.logger.warn(
        `subscription.updated missing userId/planId/creatorId. sub.id=${sub.id}`,
      );
      return;
    }

    // Stripe の status → Prisma の SubStatus
    const statusMap: Partial<Record<Stripe.Subscription.Status, SubStatus>> = {
      active: SubStatus.active,
      trialing: SubStatus.trialing,
      past_due: SubStatus.past_due,
      canceled: SubStatus.canceled,
      incomplete: SubStatus.incomplete,
      unpaid: SubStatus.past_due,
      incomplete_expired: SubStatus.canceled,
    };

    const subStatus: SubStatus =
      statusMap[sub.status] ?? SubStatus.incomplete;

    // 型定義には無いと言われるので any 経由で読む
    const anySub = sub as any;
    const periodStartSec: number = anySub.current_period_start ?? 0;
    const periodEndSec: number = anySub.current_period_end ?? 0;

    const periodStart = new Date(periodStartSec * 1000);
    const periodEnd = new Date(periodEndSec * 1000);   

    await this.prisma.subscription.updateMany({
      where: { stripeSubscriptionId: subId },
      data: {
        status: subStatus,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: sub.cancel_at_period_end || false,
      },
    });   

    await this.prisma.subscription.upsert({
      where: {
        stripeSubscriptionId: sub.id, // schema の @unique に合わせる
      },
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

    this.logger.log(
      `subscription.updated handled. subId=${sub.id}, userId=${userId}, planId=${planId}, status=${subStatus}`,
    );
  }

  async handleInvoicePaymentSucceeded(invoice: Stripe.Invoice) {
    const inv = invoice as any;
    const subscriptionId = inv.subscription as string | null;
    if (!subscriptionId) return;

    // subscription_id → DB 内の Subscription を特定
    const dbSub = await this.prisma.subscription.findUnique({
      where: { stripeSubscriptionId: String(subscriptionId) },
      select: {
        userId: true,
        creatorId: true,
        planId: true,
      },
    });

    if (!dbSub) return;

    // ★ 分配付きの Payment を作成
    const amountJpy =
      typeof invoice.amount_paid === 'number' ? invoice.amount_paid : 0;
    if (amountJpy) {
      await this.payments.createPaymentWithShare({
        userId: dbSub.userId,
        creatorId: dbSub.creatorId,
        planId: dbSub.planId,
        postId: null,
        amountJpy,
        kind: 'subscription',
        externalTxId: invoice.id,
      });
    }    

    // その Creator の ALL 投稿の中で
    // visibility=plan の投稿にアクセス権をつける
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
          // プランなら次回更新日まで
          expiresAt: null,
        },
        update: {},
      });
    }
  }

  async handlePaymentIntentSucceeded(pi: Stripe.PaymentIntent) {
    const m = pi.metadata || {};

    // metadata 必須チェック
    const userId = m.userId;
    const postId = m.postId;
    const creatorId = m.creatorId; // あってもなくてもOK（後でDBから引ける）

    if (!userId || !postId) {
      this.logger.warn('PI succeeded but missing metadata');
      return;
    }

    // Post が存在するか確認（安全目的）
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
    });
    if (!post) {
      this.logger.warn(`Post not found for PPV purchase: ${postId}`);
      return;
    }

    // ★ ここで Payment + 分配を記録する
    const amountJpy =
      typeof pi.amount_received === 'number' ? pi.amount_received : 0;
    if (!amountJpy) {
      this.logger.warn(`PI succeeded but amount_received is 0. pi.id=${pi.id}`);
      return;
    }

    await this.payments.createPaymentWithShare({
      userId,
      creatorId: creatorId ?? post.creatorId,
      planId: null,
      postId,
      amountJpy,
      kind: 'one_time',
      externalTxId: pi.id,
    });    

    // PostAccess を付与（すでにあれば無視）
    await this.prisma.postAccess.upsert({
      where: {
        userId_postId: {
          userId,
          postId,
        },
      },
      create: {
        userId,
        postId,
        // PPVは無期限アクセス
        expiresAt: null,
      },
      update: {},
    });

    this.logger.log(`PPV unlocked: user=${userId}, post=${postId}`);
  }

}
