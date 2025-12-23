// api/src/apps/payments/payments.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { CreatePaymentWithShareArgs } from 'src/shared/types';
import { StripeCheckoutService } from './stripe/stripe-checkout.service';
import { PaymentsWriterService } from './writer/payments-writer.service';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly stripeCheckout: StripeCheckoutService,
    private readonly paymentsWriter: PaymentsWriterService,
  ) {}

  async recordPaymentFromWebhook(args: CreatePaymentWithShareArgs) {
    return this.paymentsWriter.createPaymentWithShareIdempotent(args);
  }
}
