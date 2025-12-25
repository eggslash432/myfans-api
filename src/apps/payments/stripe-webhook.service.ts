// api/src/apps/payments/stripe-webhook.service.ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from './payments.service';
import { PayoutStatus } from '@prisma/client';

import { WebhookGate } from './stripe-webhook/webhook-gate';
import { AccountUpdatedHandler } from './stripe-webhook/account-updated.handler';
import { CheckoutHandler } from './stripe-webhook/checkout.handler';
import { SubscriptionHandler } from './stripe-webhook/subscription.handler';
import { InvoicePaymentSucceededHandler } from './stripe-webhook/invoice-payment-succeeded.handler';
import { PaymentIntentSucceededHandler } from './stripe-webhook/payment-intent-succeeded.handler';
import Stripe from 'stripe';
import { STRIPE_CLIENT } from './stripe-webhook/stripe-client.provider';

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
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
  ) {}

  async processEvent(event: Stripe.Event) {
    const gate = await this.gate.ensureWebhookEvent(event);

    if (gate.alreadyProcessed) {
      this.logger.log(`skip processed event: ${event.id} (${event.type})`);
      return;
    }

    await this.gate.logWebhook(gate.eventRowId, 'receive', true, event.type);

    try {
      switch (event.type) {
        case 'account.updated':
          await this.accountUpdated.handle(event.data.object as Stripe.Account);
          await this.gate.logWebhook(
            gate.eventRowId,
            'handle.account.updated',
            true,
          );
          break;

        case 'checkout.session.completed':
          await this.checkout.handle(
            event.data.object as Stripe.Checkout.Session,
          );
          await this.gate.logWebhook(
            gate.eventRowId,
            'handle.checkout.session.completed',
            true,
          );
          break;

        case 'customer.subscription.created':
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted':
          await this.subscription.handle(
            event.data.object as Stripe.Subscription,
          );
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
   * transfer.created → payout paid 確定（案A）
   * - payoutId は metadata.payoutId を最優先（無ければ description fallback）
   * - payoutStatus は approved のみ paid にする（requested は誤爆防止で拒否）
   */
  private async handleTransferCreated(transfer: Stripe.Transfer) {
    const payoutIdFromMeta =
      transfer.metadata && typeof transfer.metadata['payoutId'] === 'string'
        ? transfer.metadata['payoutId']
        : null;

    const payoutId = payoutIdFromMeta ?? extractPayoutId(transfer.description);

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

    // 冪等
    if (payout.payoutStatus === PayoutStatus.paid) return;

    // 人間判断を優先
    if (payout.payoutStatus === PayoutStatus.rejected) {
      this.logger.warn(
        `payout ${payout.id} is rejected but transfer.created arrived: transferId=${transfer.id}`,
      );
      return;
    }

    // ✅ 案A：approved のみ paid にする
    if (payout.payoutStatus !== PayoutStatus.approved) {
      this.logger.warn(
        `payout ${payout.id} status is not approved: ${payout.payoutStatus} (skip)`,
      );
      return;
    }

    // note に transferId を追記（既に別の transferId があっても追えるように）
    const tid = `transferId=${transfer.id}`;
    const nextNote = payout.note
      ? payout.note.includes(tid)
        ? payout.note
        : `${payout.note}\n${tid}`
      : tid;

    // Stripeの作成時刻を paidAt に寄せる
    const paidAt = transfer.created
      ? new Date(transfer.created * 1000)
      : new Date();

    await this.prisma.payout.update({
      where: { id: payout.id },
      data: {
        payoutStatus: PayoutStatus.paid,
        paidAt,
        note: nextNote,
      },
    });
  }

  async handle(pi: Stripe.PaymentIntent) {
    // Payment.externalTxId = PaymentIntent.id 前提でひも付け
    const payment = await this.prisma.payment.findUnique({
      where: { externalTxId: pi.id },
      select: { id: true, stripeFeeJpy: true },
    });

    if (!payment) {
      this.logger.warn(`payment not found for payment_intent: ${pi.id}`);
      return;
    }

    // 冪等（既に保存済みなら終了）
    if (typeof payment.stripeFeeJpy === 'number' && payment.stripeFeeJpy > 0) {
      return;
    }

    const latestChargeId =
      typeof pi.latest_charge === 'string'
        ? pi.latest_charge
        : pi.latest_charge?.id;

    if (!latestChargeId) {
      this.logger.warn(`latest_charge missing for payment_intent: ${pi.id}`);
      return;
    }

    const charge = await this.stripe.charges.retrieve(latestChargeId, {
      expand: ['balance_transaction'],
    });

    const bt = charge.balance_transaction as
      | Stripe.BalanceTransaction
      | string
      | null;

    if (!bt || typeof bt === 'string') {
      this.logger.warn(
        `balance_transaction not expanded for charge: ${latestChargeId}`,
      );
      return;
    }

    // JPY以外は要換算なので一旦スキップ（基本あなたの環境はJPYのはず）
    if ((bt.currency ?? '').toLowerCase() !== 'jpy') {
      this.logger.warn(
        `non-jpy currency fee detected: ${bt.currency} for pi=${pi.id}`,
      );
      return;
    }

    const feeJpy = Number(bt.fee ?? 0);

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { stripeFeeJpy: feeJpy },
    });

    this.logger.log(`stripeFeeJpy updated: payment=${payment.id} fee=${feeJpy}`);
  }  
}

function extractPayoutId(desc?: string | null): string | null {
  if (!desc) return null;

  const m1 = desc.match(/payout[_\s:]+([a-zA-Z0-9_-]+)/i);
  if (m1?.[1]) return m1[1];

  const m2 = desc.match(/creator\s+payout[\s:]+([a-zA-Z0-9_-]+)/i);
  if (m2?.[1]) return m2[1];

  return null;
}
