// api/src/apps/payments/stripe-webhook/stripe-client.provider.ts

import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

export const STRIPE_CLIENT = Symbol('STRIPE_CLIENT');

export const StripeClientProvider = {
  provide: STRIPE_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService) => {
    const secret =
      process.env.STRIPE_SECRET_KEY || config.get<string>('stripeSecretKey');
    if (!secret) throw new Error('STRIPE_SECRET_KEY is not set');
    return new Stripe(secret, {});
  },
};
