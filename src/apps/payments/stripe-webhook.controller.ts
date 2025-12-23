// api/src/apps/payments/stripe-webhook.controller.ts

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
import { Request } from 'express';

@Controller('stripe')
export class StripeWebhookController {
  private readonly stripe: Stripe;

  constructor(
    private readonly webhookService: StripeWebhookService,
    private readonly config: ConfigService,
  ) {
    const secret =
      this.config.get<string>('STRIPE_SECRET_KEY') ??
      process.env.STRIPE_SECRET_KEY;

    if (!secret) {
      throw new Error('STRIPE_SECRET_KEY is not set');
    }

    this.stripe = new Stripe(secret, { });
  }

  /**
   * Stripe Webhook 受信
   * POST /stripe/webhook
   */
  @Post('webhook')
  @HttpCode(200)
  async handleWebhook(
    @Req() req: Request & { rawBody: Buffer },
    @Headers('stripe-signature') signature?: string,
  ) {
    const whSecret =
      this.config.get<string>('STRIPE_WEBHOOK_SECRET') ??
      process.env.STRIPE_WEBHOOK_SECRET;

    if (!whSecret) {
      throw new BadRequestException('STRIPE_WEBHOOK_SECRET is not set');
    }
    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header');
    }

    let event: Stripe.Event;

    try {
      // ★ rawBody 必須（bodyParser.raw で注入される）
      event = this.stripe.webhooks.constructEvent(
        req.rawBody,
        signature,
        whSecret,
      );
    } catch (e: any) {
      // 署名不正 → 400（Stripe 側はリトライしない）
      throw new BadRequestException(
        `Webhook signature verification failed: ${e.message}`,
      );
    }

    // ★ 以降は「冪等」を前提に service 側で処理
    try {
      await this.webhookService.processEvent(event);
    } catch (e) {
      /**
       * ここで throw しないのが重要
       * - 200 を返す
       * - event.id で冪等管理していれば再送不要
       * - Stripe の無限リトライを防ぐ
       */
      console.error('[StripeWebhook] handler failed', {
        eventId: event.id,
        type: event.type,
        error: e,
      });
    }

    return { received: true };
  }
}
