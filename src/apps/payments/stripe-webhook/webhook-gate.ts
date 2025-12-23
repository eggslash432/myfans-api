// api/src/apps/payments/stripe-webhook/webhook-gate.ts
import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class WebhookGate {
  constructor(private readonly prisma: PrismaService) {}

  async ensureWebhookEvent(event: Stripe.Event): Promise<{
    eventRowId: string;
    alreadyProcessed: boolean;
  }> {
    const idempotencyKey = event.id;

    try {
      const created = await this.prisma.webhookEvent.create({
        data: {
          provider: 'stripe',
          eventType: event.type,
          idempotencyKey,
          payload: event as any,
          processed: false,
        },
        select: { id: true, processed: true },
      });
      return { eventRowId: created.id, alreadyProcessed: false };
    } catch (e: any) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const existing = await this.prisma.webhookEvent.findUnique({
          where: { idempotencyKey },
          select: { id: true, processed: true },
        });
        if (!existing) throw e;
        return { eventRowId: existing.id, alreadyProcessed: existing.processed };
      }
      throw e;
    }
  }

  async logWebhook(
    eventRowId: string,
    action: string,
    success: boolean,
    message?: string,
  ) {
    await this.prisma.webhookLog.create({
      data: { eventId: eventRowId, action, success, message },
    });
  }
}
