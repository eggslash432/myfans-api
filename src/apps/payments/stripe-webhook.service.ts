// api/src/apps/payments/stripe-webhook.service.ts
import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from './payments.service';

import { WebhookGate } from './stripe-webhook/webhook-gate';
import { AccountUpdatedHandler } from './stripe-webhook/account-updated.handler';
import { CheckoutHandler } from './stripe-webhook/checkout.handler';
import { SubscriptionHandler } from './stripe-webhook/subscription.handler';
import { InvoicePaymentSucceededHandler } from './stripe-webhook/invoice-payment-succeeded.handler';
import { PaymentIntentSucceededHandler } from './stripe-webhook/payment-intent-succeeded.handler';

@Injectable()
export class StripeWebhookService {
  private readonly logger = new Logger(StripeWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly gate: WebhookGate,
    private readonly accountUpdated: AccountUpdatedHandler,
    private readonly checkout: CheckoutHandler,
    private readonly subscription: SubscriptionHandler,
    private readonly invoiceSucceeded: InvoicePaymentSucceededHandler,
    private readonly piSucceeded: PaymentIntentSucceededHandler,
  ) {}

  async processEvent(event: Stripe.Event) {
    // ===== ① 冪等ゲート =====
    const gate = await this.gate.ensureWebhookEvent(event);

    if (gate.alreadyProcessed) {
      this.logger.log(`skip processed event: ${event.id} (${event.type})`);
      return;
    }

    await this.gate.logWebhook(gate.eventRowId, 'receive', true, event.type);

    try {
      switch (event.type) {
        // =========================
        // 既存イベント
        // =========================
        case 'account.updated':
          await this.accountUpdated.handle(event.data.object as Stripe.Account);
          await this.gate.logWebhook(gate.eventRowId, 'handle.account.updated', true);
          break;

        case 'checkout.session.completed':
          await this.checkout.handle(event.data.object as Stripe.Checkout.Session);
          await this.gate.logWebhook(
            gate.eventRowId,
            'handle.checkout.session.completed',
            true,
          );
          break;

        case 'customer.subscription.created':
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted':
          await this.subscription.handle(event.data.object as Stripe.Subscription);
          await this.gate.logWebhook(gate.eventRowId, `handle.${event.type}`, true);
          break;

        case 'invoice.payment_succeeded':
          await this.invoiceSucceeded.handle(event.data.object as Stripe.Invoice);
          await this.gate.logWebhook(
            gate.eventRowId,
            'handle.invoice.payment_succeeded',
            true,
          );
          break;

        case 'payment_intent.succeeded':
          await this.piSucceeded.handle(
            event.data.object as Stripe.PaymentIntent,
          );
          await this.gate.logWebhook(
            gate.eventRowId,
            'handle.payment_intent.succeeded',
            true,
          );
          break;

        // =========================
        // ★ 出金（Payout / Transfer）
        // =========================
        case 'transfer.created': {
          const transfer = event.data.object as Stripe.Transfer;
          await this.handleTransferCreated(transfer);
          await this.gate.logWebhook(
            gate.eventRowId,
            'handle.transfer.created',
            true,
          );
          break;
        }

        default:
          await this.gate.logWebhook(
            gate.eventRowId,
            'skip.unsupported',
            true,
            event.type,
          );
          break;
      }

      // ===== ② 処理完了マーク =====
      await this.prisma.webhookEvent.update({
        where: { id: gate.eventRowId },
        data: { processed: true, processedAt: new Date() },
      });
      await this.gate.logWebhook(gate.eventRowId, 'processed', true);
    } catch (e: any) {
      await this.gate.logWebhook(
        gate.eventRowId,
        'error',
        false,
        e?.stack || e?.message || String(e),
      );
      this.logger.error(
        `event failed: ${event.id} (${event.type})`,
        e?.stack || e,
      );
      throw e;
    }
  }

  /**
   * Stripe Transfer 完了 → payout を paid にする
   * 冪等前提（WebhookGate + payoutStatus チェック）
   */
  private async handleTransferCreated(transfer: Stripe.Transfer) {
    // description に payoutId を仕込んでいる前提
    const payoutId = extractPayoutId(transfer.description);
    if (!payoutId) {
      this.logger.warn(`transfer ${transfer.id} has no payoutId`);
      return;
    }

    const payout = await this.prisma.payout.findUnique({
      where: { id: payoutId },
    });

    if (!payout) {
      this.logger.warn(`payout not found: ${payoutId}`);
      return;
    }

    // すでに paid → 何もしない（冪等）
    if (payout.payoutStatus === 'paid') {
      return;
    }

    // approved 以外は想定外（ログのみ）
    if (payout.payoutStatus !== 'approved') {
      this.logger.warn(
        `payout ${payout.id} invalid status: ${payout.payoutStatus}`,
      );
      return;
    }

    await this.prisma.payout.update({
      where: { id: payout.id },
      data: {
        payoutStatus: 'paid',
        paidAt: new Date(),
        note: `transferId=${transfer.id}`,
      },
    });
  }
}

/**
 * description から payoutId を抽出
 * 例: "Payout payout_abc123"
 */
function extractPayoutId(desc?: string | null): string | null {
  if (!desc) return null;
  const m = desc.match(/payout[_\s:]+([a-zA-Z0-9_-]+)/i);
  return m?.[1] ?? null;
}
