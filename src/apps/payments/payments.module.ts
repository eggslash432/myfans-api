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

@Module({
  imports: [PrismaModule, ConfigModule, HelpersModule],
  controllers: [PaymentsController, CreatorPayoutsController, AdminPayoutsController, StripeWebhookController],
  providers: [PaymentsService, StripeWebhookService, PayoutsService, PrismaService],
  exports:[PayoutsService, PaymentsService, StripeWebhookService],
})
export class PaymentsModule {}
