// api/src/apps/payments/stripe-webhook/invoice-payment-succeeded.handler.ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../../prisma/prisma.service';
import { SubStatus } from '@prisma/client';
import { STRIPE_CLIENT } from './stripe-client.provider';
import { SplitTransferService } from './split-transfer.service';
import { PaymentsWriterService } from '../writer/payments-writer.service';

@Injectable()
export class InvoicePaymentSucceededHandler {
  private readonly logger = new Logger(InvoicePaymentSucceededHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentsWriter: PaymentsWriterService,
    private readonly splitTransfers: SplitTransferService,
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
  ) {}

  async handle(invoice: Stripe.Invoice) {
    const inv = invoice as any;
    const subscriptionId = inv.subscription as string | null;
    if (!subscriptionId) return;

    // -------------------------
    // chargeId 解決（Stripe送金用）
    // -------------------------
    let chargeId: string | null = null;
    const invoicePiId =
      typeof inv.payment_intent === 'string'
        ? (inv.payment_intent as string)
        : null;

    if (invoicePiId) {
      try {
        const pi = await this.stripe.paymentIntents.retrieve(invoicePiId);
        chargeId =
          typeof pi.latest_charge === 'string' ? pi.latest_charge : null;
      } catch (e: any) {
        this.logger.warn(
          `invoice.payment_succeeded: failed to retrieve PI. pi=${invoicePiId}`,
          e?.message || e,
        );
      }
    }

    // -------------------------
    // Subscription 取得（DB優先）
    // -------------------------
    let dbSub = await this.prisma.subscription.findUnique({
      where: { stripeSubscriptionId: String(subscriptionId) },
      select: { userId: true, creatorId: true, planId: true },
    });

    // -------------------------
    // DBに無ければ Stripe から復元
    // -------------------------
    if (!dbSub) {
      this.logger.warn(
        `invoice.payment_succeeded: Subscription not found in DB. Fetching from Stripe... subId=${subscriptionId}`,
      );

      const stripeSub = await this.stripe.subscriptions.retrieve(
        String(subscriptionId),
      );

      const userId = stripeSub.metadata?.userId as string | undefined;
      const planId = stripeSub.metadata?.planId as string | undefined;

      let creatorId =
        (stripeSub.metadata?.creatorId as string | undefined) ?? undefined;

      // plan から creatorId 復元（正）
      if (!creatorId && planId) {
        const plan = await this.prisma.plan.findUnique({
          where: { id: planId },
          select: { creatorId: true },
        });
        creatorId = plan?.creatorId;
      }

      if (!userId || !planId || !creatorId) {
        this.logger.error(
          `invoice.payment_succeeded: cannot recover subscription metadata. subId=${subscriptionId}`,
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

      const anySub = stripeSub as any;
      const periodStart = new Date(
        (anySub.current_period_start ?? 0) * 1000,
      );
      const periodEnd = new Date((anySub.current_period_end ?? 0) * 1000);

      await this.prisma.subscription.upsert({
        where: { stripeSubscriptionId: stripeSub.id },
        update: {
          userId,
          creatorId,
          planId,
          status: statusMap[stripeSub.status] ?? SubStatus.incomplete,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: stripeSub.cancel_at_period_end ?? false,
        },
        create: {
          userId,
          creatorId,
          planId,
          stripeSubscriptionId: stripeSub.id,
          status: statusMap[stripeSub.status] ?? SubStatus.incomplete,
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
    }

    // -------------------------
    // 金額確定
    // -------------------------
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

    // -------------------------
    // Payment 作成（ここで shopId が確定する）
    // -------------------------
    const payment = await this.paymentsWriter.createPaymentWithShareIdempotent({
      userId: dbSub.userId,
      creatorId: dbSub.creatorId, // ← 必ず creator.userId
      planId: dbSub.planId,
      postId: null,
      amountJpy,
      kind: 'subscription',
      externalTxId: invoice.id,
    });

    if (!payment) {
      this.logger.error(
        `invoice.payment_succeeded: payment is null. invoiceId=${invoice.id}`,
      );
      return;
    }

    // -------------------------
    // Transfer（shopId は payment.shopId を正とする）
    // -------------------------
    await this.splitTransfers.createSplitTransfers({
      paymentId: payment.id,
      externalTxId: invoice.id,
      amountJpy,
      creatorUserId: dbSub.creatorId,
      shopId: payment.shopId, // ← ★唯一の正解ルート
      chargeId,
    });

    // -------------------------
    // アクセス付与
    // -------------------------
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
