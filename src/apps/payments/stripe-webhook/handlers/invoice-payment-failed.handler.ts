//api/src/apps/payments/stripe-webhook/invoice-payment-failed.handler.ts

import { Inject, Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../../../prisma/prisma.service';
import { STRIPE_CLIENT } from '../transfer/stripe-client.provider';
import { NotificationsService } from '../../../notifications/notifications.service';

@Injectable()
export class InvoicePaymentFailedHandler {
  private readonly logger = new Logger(InvoicePaymentFailedHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
    private readonly notifications: NotificationsService,
  ) {}

  async handle(invoice: Stripe.Invoice) {
    const inv = invoice as any;
    const subscriptionId = inv.subscription as string | null;
    if (!subscriptionId) return;

    // DB優先でsubscriptionを引く（無ければStripeから復元）
    let dbSub = await this.prisma.subscription.findUnique({
      where: { stripeSubscriptionId: String(subscriptionId) },
      select: { userId: true, creatorId: true, planId: true },
    });

    if (!dbSub) {
      try {
        const stripeSub = await this.stripe.subscriptions.retrieve(
          String(subscriptionId),
        );

        const userId = stripeSub.metadata?.userId as string | undefined;
        const planId = stripeSub.metadata?.planId as string | undefined;

        let creatorId =
          (stripeSub.metadata?.creatorId as string | undefined) ?? undefined;

        if (!creatorId && planId) {
          const plan = await this.prisma.plan.findUnique({
            where: { id: planId },
            select: { creatorId: true },
          });
          creatorId = plan?.creatorId;
        }

        if (!userId || !planId || !creatorId) {
          this.logger.warn(
            `invoice.payment_failed: cannot recover metadata. subId=${subscriptionId}`,
          );
          return;
        }

        dbSub = { userId, creatorId, planId };
      } catch (e: any) {
        this.logger.warn(
          `invoice.payment_failed: failed to retrieve subscription. subId=${subscriptionId}`,
          e?.message || e,
        );
        return;
      }
    }

    const amountJpy =
      typeof invoice.amount_due === 'number' && invoice.amount_due > 0
        ? invoice.amount_due
        : typeof invoice.total === 'number'
          ? invoice.total
          : 0;

    // プラン名（あれば）
    let planLabel = 'プラン';
    try {
      const plan = await this.prisma.plan.findUnique({
        where: { id: dbSub.planId },
        select: { name: true },
      });
      if (plan?.name) planLabel = `「${plan.name}」`;
    } catch (_) {}

    // 失敗理由（Stripeのfailure_message等は状況で取れたり取れなかったり）
    const failureMsg =
      (inv.last_finalization_error?.message as string | undefined) ??
      (inv.payment_intent?.last_payment_error?.message as string | undefined) ??
      undefined;

    try {
      // 購読者へ
      await this.notifications.notify({
        userId: dbSub.userId,
        type: 'PAYMENT',
        source: 'WEBHOOK',
        title: 'サブスク決済に失敗しました',
        body:
          `${planLabel}の決済に失敗しました。` +
          (amountJpy ? `（¥${amountJpy.toLocaleString('ja-JP')}）` : '') +
          `\nお支払い方法をご確認ください。` +
          (failureMsg ? `\n\n参考：${failureMsg}` : ''),
      });

      // クリエイターへ（簡潔に）
      await this.notifications.notify({
        userId: dbSub.creatorId,
        type: 'PAYMENT',
        source: 'WEBHOOK',
        title: 'サブスク決済失敗',
        body:
          `${planLabel}の決済が失敗しました。` +
          (amountJpy ? `（¥${amountJpy.toLocaleString('ja-JP')}）` : ''),
      });
    } catch (e: any) {
      this.logger.warn(
        `notification failed (invoice.payment_failed). invoiceId=${invoice.id}`,
        e?.message || e,
      );
    }

    this.logger.log(
      `invoice.payment_failed handled. invoiceId=${invoice.id} subId=${subscriptionId}`,
    );
  }
}
