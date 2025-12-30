// api/src/apps/payments/stripe-webhook/subscription.handler.ts
import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../../../prisma/prisma.service';
import { SubscriptionStatus } from '@prisma/client';

@Injectable()
export class SubscriptionHandler {
  private readonly logger = new Logger(SubscriptionHandler.name);

  constructor(private readonly prisma: PrismaService) {}

  // --- 定期課金の状態更新（作成 / 更新 / 解約） ---
  async handle(sub: Stripe.Subscription) {
    const userId = (sub.metadata?.userId ?? undefined) as string | undefined;
    const planId = (sub.metadata?.planId ?? undefined) as string | undefined;
    const subId = sub.id;

    let creatorId: string | undefined = (sub.metadata?.creatorId ??
      undefined) as string | undefined;

    if (!creatorId && planId) {
      const plan = await this.prisma.plan.findUnique({
        where: { id: planId },
        select: { creatorId: true },
      });
      creatorId = plan?.creatorId;
    }

    if (!userId || !planId || !creatorId) {
      this.logger.warn(
        `subscription.updated missing userId/planId/creatorId. sub.id=${sub.id}`,
      );
      return;
    }

    const statusMap: Partial<Record<Stripe.Subscription.Status, SubscriptionStatus>> = {
      active: SubscriptionStatus.active,
      trialing: SubscriptionStatus.trialing,
      past_due: SubscriptionStatus.past_due,
      canceled: SubscriptionStatus.canceled,
      incomplete: SubscriptionStatus.incomplete,
      unpaid: SubscriptionStatus.past_due,
      incomplete_expired: SubscriptionStatus.canceled,
    };

    const subStatus: SubscriptionStatus = statusMap[sub.status] ?? SubscriptionStatus.incomplete;

    const anySub = sub as any;
    const periodStartSec: number = anySub.current_period_start ?? 0;
    const periodEndSec: number = anySub.current_period_end ?? 0;

    const periodStart = new Date(periodStartSec * 1000);
    const periodEnd = new Date(periodEndSec * 1000);

    await this.prisma.subscription.upsert({
      where: { stripeSubscriptionId: subId },
      update: {
        userId,
        creatorId,
        planId,
        status: subStatus,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
      },
      create: {
        userId,
        creatorId,
        planId,
        stripeSubscriptionId: subId,
        status: subStatus,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
      },
    });

    this.logger.log(
      `subscription.updated handled. subId=${sub.id}, userId=${userId}, planId=${planId}, status=${subStatus}`,
    );
  }
}
