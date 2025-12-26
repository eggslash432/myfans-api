// api/src/apps/payments/stripe-webhook/checkout.handler.ts
import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class CheckoutHandler {
  private readonly logger = new Logger(CheckoutHandler.name);

  constructor(private readonly prisma: PrismaService) {}

  // --- Checkout 完了（PPV / 初回決済） ---
  async handle(session: Stripe.Checkout.Session) {
    const userId = session.metadata?.userId ?? null;
    const planId = session.metadata?.planId ?? null;
    const postId = session.metadata?.postId ?? null;

    if (!userId) {
      this.logger.warn(
        `checkout.session.completed without userId. session.id=${session.id}`,
      );
      return;
    }

    // PPV（単品）購入なら PostAccess を付与（保険）
    if (postId && !planId) {
      await this.prisma.postAccess.upsert({
        where: { userId_postId: { userId, postId } },
        update: { expiresAt: null },
        create: { userId, postId, expiresAt: null },
      });
    }

    this.logger.log(
      `checkout.session.completed handled. userId=${userId}, planId=${planId}, postId=${postId}`,
    );
  }
}
