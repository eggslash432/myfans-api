// api/src/apps/payments/stripe-webhook/invoice-payment-succeeded.handler.ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentsService } from '../payments.service';
import { SubStatus } from '@prisma/client';

import { STRIPE_CLIENT } from './stripe-client.provider';
import { SplitTransferService } from './split-transfer.service';

@Injectable()
export class InvoicePaymentSucceededHandler {
  private readonly logger = new Logger(InvoicePaymentSucceededHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly splitTransfers: SplitTransferService,
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
  ) {}

  // ✅ Subscription未作成でもフォールバックしてPayment/Access付与まで通す
  async handle(invoice: Stripe.Invoice) {
    const inv = invoice as any;
    const subscriptionId = inv.subscription as string | null;
    if (!subscriptionId) return;

    let shopIdResolved: string | null =
      (invoice.metadata?.shopId as string | undefined) ?? null;

    let chargeId: string | null = null;
    const invoicePiId =
      typeof inv.payment_intent === 'string'
        ? (inv.payment_intent as string)
        : null;

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
        shopIdResolved ??
        ((stripeSub.metadata?.shopId as string | undefined) ?? null);

      const userId = (stripeSub.metadata?.userId ?? undefined) as
        | string
        | undefined;
      const planId = (stripeSub.metadata?.planId ?? undefined) as
        | string
        | undefined;

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
      // creator.shopId にフォールバック（creatorId は「creatorのuserId」運用前提）
      const c = await this.prisma.creator.findUnique({
        where: { userId: dbSub.creatorId },
        select: { shopId: true },
      });
      shopIdResolved = (c?.shopId as any) ?? null;
    }

    const amountJpy =
      typeof invoice.amount_paid === 'number' && invoice.amount_paid > 0
        ? invoice.amount_paid
        : typeof invoice.total === 'number'
          ? invoice.total
          : 0;

    if (!amountJpy) {
      this.logger.warn(
        `invoice.payment_succeeded: amount is 0. invoiceId=${invoice.id}`,
      );
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
    await this.splitTransfers.createSplitTransfers({
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
}
