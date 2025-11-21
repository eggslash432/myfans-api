// src/apps/payments/stripe-webhook.controller.ts
import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { StripeWebhookService } from './stripe-webhook.service';

@Controller('payments')
export class StripeWebhookController {
  private readonly stripe: Stripe;

  constructor(
    private readonly webhookService: StripeWebhookService,
    private readonly config: ConfigService,
  ) {
    const secret =
      process.env.STRIPE_SECRET_KEY ||
      this.config.get<string>('stripeSecretKey');

    if (!secret) {
      throw new Error('STRIPE_SECRET_KEY is not set');
    }

    this.stripe = new Stripe(secret, { });
  }

  @Post('webhook')
  @HttpCode(200) // Stripe は 2xx 応答が必須
  async handleWebhook(
    @Req() req: any,
    @Headers('stripe-signature') signature?: string,
  ) {
    const whSecret =
      process.env.STRIPE_WEBHOOK_SECRET ||
      this.config.get<string>('stripeWebhookSecret');

    if (!whSecret) {
      throw new BadRequestException('STRIPE_WEBHOOK_SECRET is not set');
    }
    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header');
    }

    let event: Stripe.Event;
    try {
      // main.ts で rawBody を通しているので rawBody 優先
      const buf = req.rawBody ?? req.body;
      event = this.stripe.webhooks.constructEvent(buf, signature, whSecret);
    } catch (e: any) {
      throw new BadRequestException(
        `Webhook signature verification failed: ${e.message}`,
      );
    }

    switch (event.type) {
      case 'account.updated':
        await this.webhookService.handleAccountUpdated(
          event.data.object as Stripe.Account,
        );
        break;

      case 'checkout.session.completed':
        await this.webhookService.handleCheckoutSessionCompleted(
          event.data.object as Stripe.Checkout.Session,
        );
        break;

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await this.webhookService.handleSubscriptionUpdated(
          event.data.object as Stripe.Subscription,
        );
        break;

      default:
        // 必要ならログだけ残す
        // this.logger.log(`Unhandled event type: ${event.type}`);
        break;
    }

    return { received: true };
  }
}
