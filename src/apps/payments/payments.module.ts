import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller'
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentsService } from './payments.service';
import { StripeWebhookService } from './stripe-webhook.service';
import { PayoutsService } from './payouts.service';
import { CreatorPayoutsController } from './payouts.creator.controller';
import { AdminPayoutsController } from './payouts.admin.controller';

@Module({
  imports: [PrismaModule],
  controllers: [PaymentsController, CreatorPayoutsController, AdminPayoutsController],
  providers: [PaymentsService, StripeWebhookService, PayoutsService],
  exports:[PayoutsService],
})
export class PaymentsModule {}
