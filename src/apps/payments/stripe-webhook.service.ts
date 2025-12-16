// api/src/apps/payments/stripe-webhook.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import Stripe from 'stripe';
import {
  KycStatus,
  PaymentKind,
  PaymentStatus,
  SubStatus,
  TransferKind,
} from '@prisma/client';
import { Prisma } from '@prisma/client';
import { PaymentsService } from './payments.service';

@Injectable()
export class StripeWebhookService {
  private readonly logger = new Logger(StripeWebhookService.name);
  private readonly stripe: Stripe;

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly config: ConfigService,
  ) {
    const secret =
      process.env.STRIPE_SECRET_KEY ||
      this.config.get<string>('stripeSecretKey');

    if (!secret) throw new Error('STRIPE_SECRET_KEY is not set');
    this.stripe = new Stripe(secret, {});
  }

  // ---------------------------
  // Webhook入口：冪等 + ログ
  // ---------------------------
  async processEvent(event: Stripe.Event) {
    const gate = await this.ensureWebhookEvent(event);

    // すでに完全処理済みならスキップ
    if (gate.alreadyProcessed) {
      this.logger.log(`skip processed event: ${event.id} (${event.type})`);
      return;
    }

    // 受信ログ
    await this.logWebhook(gate.eventRowId, 'receive', true, `${event.type}`);

    try {
      switch (event.type) {
        case 'account.updated':
          await this.handleAccountUpdated(event.data.object as Stripe.Account);
          await this.logWebhook(gate.eventRowId, 'handle.account.updated', true);
          break;

        case 'checkout.session.completed':
          await this.handleCheckoutSessionCompleted(
            event.data.object as Stripe.Checkout.Session,
          );
          await this.logWebhook(
            gate.eventRowId,
            'handle.checkout.session.completed',
            true,
          );
          break;

        case 'customer.subscription.created':
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted':
          await this.handleSubscriptionUpdated(
            event.data.object as Stripe.Subscription,
          );
          await this.logWebhook(
            gate.eventRowId,
            `handle.${event.type}`,
            true,
          );
          break;

        case 'invoice.payment_succeeded':
          await this.handleInvoicePaymentSucceeded(
            event.data.object as Stripe.Invoice,
          );
          await this.logWebhook(
            gate.eventRowId,
            'handle.invoice.payment_succeeded',
            true,
          );
          break;

        case 'payment_intent.succeeded':
          await this.handlePaymentIntentSucceeded(
            event.data.object as Stripe.PaymentIntent,
          );
          await this.logWebhook(
            gate.eventRowId,
            'handle.payment_intent.succeeded',
            true,
          );
          break;

        default:
          await this.logWebhook(
            gate.eventRowId,
            'skip.unsupported',
            true,
            event.type,
          );
          break;
      }

      // 完了マーク
      await this.prisma.webhookEvent.update({
        where: { id: gate.eventRowId },
        data: { processed: true, processedAt: new Date() },
      });
      await this.logWebhook(gate.eventRowId, 'processed', true);
    } catch (e: any) {
      await this.logWebhook(
        gate.eventRowId,
        'error',
        false,
        e?.stack || e?.message || String(e),
      );
      this.logger.error(`event failed: ${event.id} (${event.type})`, e?.stack || e);
      throw e; // 5xx -> Stripe retry
    }
  }

  /**
   * WebhookEvent を冪等作成（Stripe event.id を idempotencyKey）
   * - 既存が processed=true ならスキップ
   * - processed=false なら再処理を許可（過去失敗のリトライ用）
   */
  private async ensureWebhookEvent(event: Stripe.Event): Promise<{
    eventRowId: string;
    alreadyProcessed: boolean;
  }> {
    const idempotencyKey = event.id;

    try {
      const created = await this.prisma.webhookEvent.create({
        data: {
          provider: 'stripe',
          eventType: event.type,
          idempotencyKey,
          payload: event as any,
          processed: false,
        },
        select: { id: true, processed: true },
      });
      return { eventRowId: created.id, alreadyProcessed: false };
    } catch (e: any) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const existing = await this.prisma.webhookEvent.findUnique({
          where: { idempotencyKey },
          select: { id: true, processed: true },
        });
        if (!existing) throw e;
        return { eventRowId: existing.id, alreadyProcessed: existing.processed };
      }
      throw e;
    }
  }

  private async logWebhook(
    eventRowId: string,
    action: string,
    success: boolean,
    message?: string,
  ) {
    await this.prisma.webhookLog.create({
      data: {
        eventId: eventRowId,
        action,
        success,
        message,
      },
    });
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

  // ✅ Subscription未作成でもフォールバックしてPayment/Access付与まで通す
  async handleInvoicePaymentSucceeded(invoice: Stripe.Invoice) {
    const inv = invoice as any;
    const subscriptionId = inv.subscription as string | null;
    if (!subscriptionId) return;

    let shopIdResolved: string | null =
      (invoice.metadata?.shopId as string | undefined) ?? null;

    let chargeId: string | null = null;
    const invoicePiId =
      typeof inv.payment_intent === 'string' ? (inv.payment_intent as string) : null;

    if (invoicePiId) {
      try {
        const pi = await this.stripe.paymentIntents.retrieve(invoicePiId);
        chargeId = typeof pi.latest_charge === 'string' ? pi.latest_charge : null;

        shopIdResolved =
          shopIdResolved ?? ((pi.metadata?.shopId as string | undefined) ?? null);
      } catch (e: any) {
        this.logger.warn(
          `invoice.payment_succeeded: failed to retrieve PI. pi=${invoicePiId}`,
          e?.message || e,
        );
      }
    }

    let dbSub = await this.prisma.subscription.findUnique({
      where: { stripeSubscriptionId: String(subscriptionId) },
      select: { userId: true, creatorId: true, planId: true },
    });

    let stripeSub: Stripe.Subscription | null = null;

    if (!dbSub) {
      this.logger.warn(
        `invoice.payment_succeeded: Subscription not found in DB. Fetching from Stripe... subId=${subscriptionId}`,
      );

      stripeSub = await this.stripe.subscriptions.retrieve(String(subscriptionId));

      shopIdResolved =
        shopIdResolved ?? ((stripeSub.metadata?.shopId as string | undefined) ?? null);

      const userId = (stripeSub.metadata?.userId ?? undefined) as string | undefined;
      const planId = (stripeSub.metadata?.planId ?? undefined) as string | undefined;

      let creatorId: string | undefined =
        (stripeSub.metadata?.creatorId ?? undefined) as string | undefined;

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
      const subStatus: SubStatus = statusMap[stripeSub.status] ?? SubStatus.incomplete;

      const anySub = stripeSub as any;
      const periodStartSec: number = anySub.current_period_start ?? 0;
      const periodEndSec: number = anySub.current_period_end ?? 0;

      const periodStart = new Date(periodStartSec * 1000);
      const periodEnd = new Date(periodEndSec * 1000);

      await this.prisma.subscription.upsert({
        where: { stripeSubscriptionId: stripeSub.id },
        update: {
          userId,
          creatorId,
          planId,
          status: subStatus,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: stripeSub.cancel_at_period_end ?? false,
        },
        create: {
          userId,
          creatorId,
          planId,
          stripeSubscriptionId: stripeSub.id,
          status: subStatus,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: stripeSub.cancel_at_period_end ?? false,
        },
      });

      dbSub = await this.prisma.subscription.findUnique({
        where: { stripeSubscriptionId: String(subscriptionId) },
        select: { userId: true, creatorId: true, planId: true },
      });
      if (!dbSub) return;
    } else {
      if (!shopIdResolved) {
        try {
          stripeSub = await this.stripe.subscriptions.retrieve(String(subscriptionId));
          shopIdResolved = (stripeSub.metadata?.shopId as string | undefined) ?? null;
        } catch (e: any) {
          this.logger.warn(
            `invoice.payment_succeeded: failed to retrieve subscription for shopId. sub=${subscriptionId}`,
            e?.message || e,
          );
        }
      }
    }

    if (!shopIdResolved) {
      const c = await this.prisma.creator.findUnique({
        where: { userId: dbSub.creatorId },
        select: { shopId: true },
      });
      shopIdResolved = (c?.shopId as any) ?? null;
    }

    const amountJpy =
      typeof invoice.amount_paid === 'number' && invoice.amount_paid > 0
        ? invoice.amount_paid
        : (typeof invoice.total === 'number' ? invoice.total : 0);

    if (!amountJpy) {
      this.logger.warn(`invoice.payment_succeeded: amount is 0. invoiceId=${invoice.id}`);
      return;
    }

    // ✅ 先に Payment を作る（Transfer.paymentId 必須のため）
    const payment = await this.payments.createPaymentWithShareIdempotentV2({
      userId: dbSub.userId,
      creatorId: dbSub.creatorId,
      planId: dbSub.planId,
      postId: null,
      amountJpy,
      kind: 'subscription',
      externalTxId: invoice.id,
    });

    // ✅ その後に Transfer（Stripe送金 + DB Transfer）
    await this.createSplitTransfers({
      paymentId: payment.id,
      externalTxId: invoice.id,
      amountJpy,
      creatorId: dbSub.creatorId,
      shopId: shopIdResolved,
      chargeId,
    });

    // plan投稿アクセス付与
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
        where: { userId_postId: { userId: dbSub.userId, postId: p.id } },
        create: { userId: dbSub.userId, postId: p.id, expiresAt: null },
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

    const shopId = (pi.metadata?.shopId as string | undefined) ?? null;
    const chargeId = typeof pi.latest_charge === 'string' ? pi.latest_charge : null;

    // ✅ 先に Payment を作る
    const payment = await this.payments.createPaymentWithShareIdempotentV2({
      userId,
      creatorId: resolvedCreatorId,
      planId: null,
      postId,
      amountJpy,
      kind: 'one_time',
      externalTxId: pi.id,
    });

    // ✅ その後 Transfer
    await this.createSplitTransfers({
      paymentId: payment.id,
      externalTxId: pi.id,
      amountJpy,
      creatorId: resolvedCreatorId,
      shopId,
      chargeId,
    });

    // Access は upsert なので安全
    await this.prisma.postAccess.upsert({
      where: { userId_postId: { userId, postId } },
      create: { userId, postId, expiresAt: null },
      update: {},
    });

    this.logger.log(`PPV unlocked: user=${userId}, post=${postId} pi=${pi.id}`);
  }

  // --- FeeSetting safe ---
  private async getFeeSettingSafe() {
    const fs = await this.prisma.feeSetting.findFirst();
    return (
      fs ?? {
        id: 1,
        managerPercent: 20,
        shopPercent: 10,
        creatorPercent: 70,
        updatedAt: new Date(),
      }
    );
  }

  private splitByFeeSetting(totalJpy: number, setting: any) {
    const manager = Math.floor((totalJpy * (setting.managerPercent ?? 0)) / 100);
    const shop = Math.floor((totalJpy * (setting.shopPercent ?? 0)) / 100);
    const creator = totalJpy - manager - shop;
    return { managerAmountJpy: manager, shopAmountJpy: shop, creatorAmountJpy: creator };
  }

  // --- 分割Transfer：Stripe送金 + DB Transfer（paymentId 必須） ---
  private async createSplitTransfers(params: {
    paymentId: string;
    externalTxId: string; // invoice.id or pi.id
    amountJpy: number;
    creatorId: string;
    shopId?: string | null;
    chargeId?: string | null;
  }) {
    const { paymentId, externalTxId, amountJpy, creatorId, shopId, chargeId } = params;

    const creator = await this.prisma.creator.findUnique({
      where: { userId: creatorId },
      select: { stripeAccountId: true },
    });
    if (!creator?.stripeAccountId) {
      this.logger.warn(`transfer skipped: creator has no stripeAccountId creatorId=${creatorId}`);
      return;
    }

    const feeSetting = await this.getFeeSettingSafe();
    const split = this.splitByFeeSetting(amountJpy, feeSetting);

    // まず DBに platform 取り分（Stripe transfer は不要なのでローカルIDで冪等化）
    if ((split.managerAmountJpy ?? 0) > 0) {
      await this.prisma.transfer.upsert({
        where: { stripeTransferId: `local_${externalTxId}_platform` },
        update: { amountJpy: split.managerAmountJpy, destinationAcct: 'platform' },
        create: {
          paymentId,
          kind: TransferKind.platform,
          amountJpy: split.managerAmountJpy,
          destinationAcct: 'platform',
          stripeTransferId: `local_${externalTxId}_platform`,
        },
      });
    }

    // creator 送金（Stripe Transfer -> DB Transfer）
    if (split.creatorAmountJpy > 0) {
      const tr = await this.stripe.transfers.create(
        {
          amount: split.creatorAmountJpy,
          currency: 'jpy',
          destination: creator.stripeAccountId,
          transfer_group: externalTxId,
          source_transaction: chargeId ?? undefined,
          metadata: { kind: 'creator', creatorId, shopId: shopId ?? '' },
        },
        { idempotencyKey: `tr_${externalTxId}_creator` },
      );

      await this.prisma.transfer.upsert({
        where: { stripeTransferId: tr.id },
        update: {
          paymentId,
          kind: TransferKind.creator,
          amountJpy: split.creatorAmountJpy,
          destinationAcct: creator.stripeAccountId,
        },
        create: {
          paymentId,
          kind: TransferKind.creator,
          amountJpy: split.creatorAmountJpy,
          destinationAcct: creator.stripeAccountId,
          stripeTransferId: tr.id,
        },
      });
    }

    // shop 送金（shopId があるときのみ）
    if (shopId && split.shopAmountJpy > 0) {
      const shop = await this.prisma.shop.findUnique({
        where: { id: shopId },
        select: { stripeAccountId: true },
      });

      if (!shop?.stripeAccountId) {
        this.logger.warn(`shop transfer skipped: shop has no stripeAccountId shopId=${shopId}`);
        return;
      }

      const tr = await this.stripe.transfers.create(
        {
          amount: split.shopAmountJpy,
          currency: 'jpy',
          destination: shop.stripeAccountId,
          transfer_group: externalTxId,
          source_transaction: chargeId ?? undefined,
          metadata: { kind: 'shop', creatorId, shopId },
        },
        { idempotencyKey: `tr_${externalTxId}_shop` },
      );

      await this.prisma.transfer.upsert({
        where: { stripeTransferId: tr.id },
        update: {
          paymentId,
          kind: TransferKind.shop,
          amountJpy: split.shopAmountJpy,
          destinationAcct: shop.stripeAccountId,
        },
        create: {
          paymentId,
          kind: TransferKind.shop,
          amountJpy: split.shopAmountJpy,
          destinationAcct: shop.stripeAccountId,
          stripeTransferId: tr.id,
        },
      });
    }
  }
}
