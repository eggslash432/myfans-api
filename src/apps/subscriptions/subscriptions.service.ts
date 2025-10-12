import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from 'src/apps/prisma/prisma.service';
import Stripe from 'stripe';

@Injectable()
export class SubscriptionsService {
  private stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

  constructor(private prisma: PrismaService) {}

  async cancelSubscription(userId: string, id: string) { // ← string に変更
    const sub = await this.prisma.subscription.findUnique({ where: { id } });
    if (!sub) throw new NotFoundException('購読が見つかりません');
    if (sub.userId !== userId) throw new ForbiddenException();

    // Stripe側に外部サブスクIDを持っていれば即キャンセル
    if (sub.externalSubId) {
      await this.stripe.subscriptions.cancel(sub.externalSubId, {
        invoice_now: false,
        prorate: false,
      });
    }

    return this.prisma.subscription.update({
      where: { id },
      data: {
        status: 'canceled',
        // cancelAtPeriodEnd: false, // 必要なら併用
        // currentPeriodEnd: new Date(), // 必要なら併用
      },
    });
  }
}
