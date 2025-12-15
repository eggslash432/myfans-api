// api/src/apps/payments/stripe-webhook.controller.ts
import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
  InternalServerErrorException,
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

    if (!secret) throw new Error('STRIPE_SECRET_KEY is not set');

    this.stripe = new Stripe(secret, {});
  }

  @Post('webhook')
  @HttpCode(200)
  async handleWebhook(
    @Req() req: any,
    @Headers('stripe-signature') signature?: string,
  ) {
    const whSecret =
      process.env.STRIPE_WEBHOOK_SECRET ||
      this.config.get<string>('stripeWebhookSecret');

    if (!whSecret) throw new BadRequestException('STRIPE_WEBHOOK_SECRET is not set');
    if (!signature) throw new BadRequestException('Missing stripe-signature header');

    let event: Stripe.Event;
    let raw: Buffer | string;

    try {
      raw = (req.rawBody ?? req.body) as any;
      event = this.stripe.webhooks.constructEvent(raw, signature, whSecret);
    } catch (e: any) {
      throw new BadRequestException(`Webhook signature verification failed: ${e.message}`);
    }

    try {
      // ★ 入口の冪等 + 振り分けは service 側でまとめて行う
      await this.webhookService.processEvent(event);
    } catch (e: any) {
      // ここで 5xx を返すと Stripe がリトライしてくれる
      // ※ event.id で冪等にしておけば “リトライ = 安全な再実行” になる
      throw new InternalServerErrorException(e?.message || 'Webhook handler failed');
    }

    return { received: true };
  }
}
