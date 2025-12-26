// api/src/apps/payments/payments.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { PrismaModule } from '../prisma/prisma.module';
import { HelpersModule } from '../helpers/helpers.module';

import { PayoutsModule } from './payouts/payouts.module';

import { PaymentsController } from './payments.controller';
import { CreatorPayoutsController } from './payouts.creator.controller';
import { AdminPayoutsController } from './payouts.admin.controller';

import { PaymentsService } from './payments.service';
import { StripeCheckoutService } from './stripe/stripe-checkout.service';
import { PaymentsWriterService } from './writer/payments-writer.service';
import { PaymentShareService } from './share/payment-share.service';

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
    AdminPayoutsController
  ],
  providers: [
    PaymentsService, 
    StripeCheckoutService, 
    PaymentsWriterService, 
    PaymentShareService
  ],
  exports: [
    PaymentsService, 
    PaymentsWriterService, 
    StripeCheckoutService
  ],
})
export class PaymentsModule {}
