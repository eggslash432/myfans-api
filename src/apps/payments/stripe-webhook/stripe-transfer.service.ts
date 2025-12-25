// api/src/apps/payments/stripe-webhook/stripe-transfer.service.ts
import { Inject, Injectable } from '@nestjs/common';
import Stripe from 'stripe';
import { STRIPE_CLIENT } from './stripe-client.provider';

@Injectable()
export class StripeTransferService {
  constructor(@Inject(STRIPE_CLIENT) private readonly stripe: Stripe) {}

  async createTransfer(params: {
    amountJpy: number;
    destination: string;
    transferGroup: string;
    chargeId?: string | null;
    idempotencyKey: string;
    metadata: Record<string, string>;
  }) {
    const { amountJpy, destination, transferGroup, chargeId, idempotencyKey, metadata } = params;

    return this.stripe.transfers.create(
      {
        amount: amountJpy,
        currency: 'jpy',
        destination,
        transfer_group: transferGroup,
        source_transaction: chargeId ?? undefined,
        metadata,
      },
      { idempotencyKey },
    );
  }
}
