// api/src/apps/payments/payments.module.ts

import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller'
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentsService } from './payments.service';
import { StripeWebhookService } from './stripe-webhook.service';
import { PayoutsService } from './payouts.service';
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


@Module({
  imports: [PrismaModule, ConfigModule, HelpersModule],
  controllers: [PaymentsController, CreatorPayoutsController, AdminPayoutsController, StripeWebhookController],
  providers: [
    PaymentsService, 
    StripeWebhookService, 
    PayoutsService, 
    PrismaService,
    WebhookGate,
    StripeClientProvider,
    AccountUpdatedHandler,
    CheckoutHandler,
    SubscriptionHandler,
    InvoicePaymentSucceededHandler,
    PaymentIntentSucceededHandler,
    SplitTransferService,    
  ],
  exports:[PayoutsService, PaymentsService, StripeWebhookService],
})
export class PaymentsModule {}
