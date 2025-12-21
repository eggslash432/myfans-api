// api/src/apps/creators/stripe/stripe-client.provider.ts

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

@Injectable()
export class StripeClientProvider {
  readonly stripe: Stripe;

  constructor(private readonly config: ConfigService) {
    const key =
      this.config.get<string>('STRIPE_SECRET_KEY') ?? process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
    this.stripe = new Stripe(key);
  }
}
