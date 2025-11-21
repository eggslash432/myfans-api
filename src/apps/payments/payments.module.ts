import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller'
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentsService } from './payments.service';
import { StripeWebhookService } from './stripe-webhook.service';

@Module({
  imports: [PrismaModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, StripeWebhookService],
})
export class PaymentsModule {}
