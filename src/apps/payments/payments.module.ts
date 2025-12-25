// api/src/apps/payments/payments.module.ts

import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller'
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentsService } from './payments.service';
import { StripeWebhookService } from './stripe-webhook.service';
import { CreatorPayoutsController } from './payouts.creator.controller';
import { AdminPayoutsController } from './payouts.admin.controller';
import { ConfigModule } from '@nestjs/config';
import { HelpersModule } from '../helpers/helpers.module';
import { StripeWebhookController } from './stripe-webhook.controller';
import { PrismaService } from '../prisma/prisma.service';

import { StripeClientProvider } from './stripe-webhook/stripe-client.provider';
import { WebhookGate } from './stripe-webhook/webhook-gate';
import { AccountUpdatedHandler } from './stripe-webhook/account-updated.handler';
import { CheckoutHandler } from './stripe-webhook/checkout.handler';
import { SubscriptionHandler } from './stripe-webhook/subscription.handler';
import { InvoicePaymentSucceededHandler } from './stripe-webhook/invoice-payment-succeeded.handler';
import { PaymentIntentSucceededHandler } from './stripe-webhook/payment-intent-succeeded.handler';
import { SplitTransferService } from './stripe-webhook/split-transfer.service';
import { PaymentShareService } from './share/payment-share.service';
import { StripeCheckoutService } from './stripe/stripe-checkout.service';
import { PaymentsWriterService } from './writer/payments-writer.service';
import { PayoutsModule } from './payouts.module';
import { TransferLedgerService } from './stripe-webhook/transfer-ledger.service';
import { StripeTransferService } from './stripe-webhook/stripe-transfer.service';


@Module({
  imports: [
    PrismaModule, 
    ConfigModule, 
    HelpersModule,
    PayoutsModule,
  ],
  controllers: [
    PaymentsController, 
    CreatorPayoutsController, 
    AdminPayoutsController, 
    StripeWebhookController
  ],
  providers: [
    PaymentsService, 
    StripeWebhookService, 
    PrismaService,
    WebhookGate,
    StripeClientProvider,
    AccountUpdatedHandler,
    CheckoutHandler,
    SubscriptionHandler,
    InvoicePaymentSucceededHandler,
    PaymentIntentSucceededHandler,
    SplitTransferService,    
    PaymentShareService,
    StripeCheckoutService,
    PaymentsWriterService,   
    SplitTransferService,
    TransferLedgerService,
    StripeTransferService,    
  ],
  exports:[
    PaymentsService, 
    PaymentsWriterService,
    StripeCheckoutService,
    StripeWebhookService,
  ],
})
export class PaymentsModule {}
