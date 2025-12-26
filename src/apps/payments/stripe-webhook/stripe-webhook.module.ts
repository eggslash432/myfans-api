// api/src/apps/payments/stripe-webhook/stripe-webhook.module.ts

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { HelpersModule } from '../../helpers/helpers.module';

import { StripeWebhookController } from '../stripe-webhook.controller';
import { StripeWebhookService } from '../stripe-webhook.service';

import { StripeClientProvider } from './stripe-client.provider';
import { WebhookGate } from './webhook-gate';

import { AccountUpdatedHandler } from './account-updated.handler';
import { CheckoutHandler } from './checkout.handler';
import { SubscriptionHandler } from './subscription.handler';
import { InvoicePaymentSucceededHandler } from './invoice-payment-succeeded.handler';
import { InvoicePaymentFailedHandler } from './invoice-payment-failed.handler';
import { PaymentIntentSucceededHandler } from './payment-intent-succeeded.handler';
import { PaymentIntentFailedHandler } from './payment-intent-failed.handler';

import { SplitTransferService } from './split-transfer.service';
import { TransferLedgerService } from './transfer-ledger.service';
import { StripeTransferService } from './stripe-transfer.service';

import { PaymentsWriterService } from '../writer/payments-writer.service';
import { PaymentShareService } from '../share/payment-share.service';

@Module({
  imports: [PrismaModule, ConfigModule, HelpersModule, NotificationsModule],
  controllers: [StripeWebhookController],
  providers: [
    StripeWebhookService,

    WebhookGate,
    StripeClientProvider,

    AccountUpdatedHandler,
    CheckoutHandler,
    SubscriptionHandler,
    InvoicePaymentSucceededHandler,
    InvoicePaymentFailedHandler,
    PaymentIntentSucceededHandler,
    PaymentIntentFailedHandler,

    SplitTransferService,
    TransferLedgerService,
    StripeTransferService,

    // Webhookが依存してるやつ（Writer/Share）
    PaymentsWriterService,
    PaymentShareService,
  ],
  exports: [StripeWebhookService],
})
export class StripeWebhookModule {}
