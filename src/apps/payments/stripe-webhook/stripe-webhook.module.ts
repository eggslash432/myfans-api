// api/src/apps/payments/stripe-webhook/stripe-webhook.module.ts

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { HelpersModule } from '../../helpers/helpers.module';

import { StripeWebhookController } from '../stripe-webhook.controller';
import { StripeWebhookService } from '../stripe-webhook.service';

import { StripeClientProvider } from './transfer/stripe-client.provider';
import { WebhookGate } from './webhook-gate';

import { AccountUpdatedHandler } from './handlers/account-updated.handler';
import { CheckoutHandler } from './handlers/checkout.handler';
import { SubscriptionHandler } from './handlers/subscription.handler';
import { InvoicePaymentSucceededHandler } from './handlers/invoice-payment-succeeded.handler';
import { InvoicePaymentFailedHandler } from './handlers/invoice-payment-failed.handler';
import { PaymentIntentSucceededHandler } from './handlers/payment-intent-succeeded.handler';
import { PaymentIntentFailedHandler } from './handlers/payment-intent-failed.handler';

import { SplitTransferService } from './transfer/split-transfer.service';
import { TransferLedgerService } from './transfer/transfer-ledger.service';
import { StripeTransferService } from './transfer/stripe-transfer.service';

import { PaymentsWriterService } from '../writer/payments-writer.service';
import { PaymentShareService } from '../share/payment-share.service';
import { PaymentsModule } from '../payments.module';

@Module({
  imports: [
    PrismaModule, 
    ConfigModule, 
    HelpersModule, 
    NotificationsModule,
    PaymentsModule,
  ],
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
    PaymentsWriterService,
    PaymentShareService,
  ],
  exports: [StripeWebhookService],
})
export class StripeWebhookModule {}
