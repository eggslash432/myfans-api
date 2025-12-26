// api/src/apps/payments/stripe-webhook/payment-intent-failed.handler.ts
import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../../../notifications/notifications.service';
import { NotificationSource, NotificationType } from '@prisma/client';

@Injectable()
export class PaymentIntentFailedHandler {
  private readonly logger = new Logger(PaymentIntentFailedHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async handle(pi: Stripe.PaymentIntent) {
    const m = pi.metadata || {};
    const userId = (m.userId as string | undefined) ?? undefined;
    const postId = (m.postId as string | undefined) ?? undefined;

    // PPVは postId 前提運用
    if (!userId || !postId) {
      this.logger.warn(
        `PI failed but missing metadata. pi.id=${pi.id} userId=${userId} postId=${postId}`,
      );
      return;
    }

    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      select: { id: true, creatorId: true, title: true },
    });
    if (!post?.creatorId) return;

    const amountJpy =
      typeof pi.amount === 'number' && pi.amount > 0 ? pi.amount : 0;

    const failureMsg =
      (pi.last_payment_error?.message as string | undefined) ?? undefined;

    try {
      const postLabel = post.title ? `「${post.title}」` : '有料投稿';

      // 購入者へ
      await this.notifications.notify({
        userId,
        type: NotificationType.PAYMENT,
        source: NotificationSource.WEBHOOK,
        title: '決済に失敗しました',
        body:
          `${postLabel}の購入に失敗しました。` +
          (amountJpy ? `（¥${amountJpy.toLocaleString('ja-JP')}）` : '') +
          `\nお支払い方法をご確認ください。` +
          (failureMsg ? `\n\n参考：${failureMsg}` : ''),
      });

      // クリエイターへ（簡潔に）
      await this.notifications.notify({
        userId: post.creatorId,
        type: NotificationType.PAYMENT,
        source: NotificationSource.WEBHOOK,
        title: '購入失敗',
        body: `${postLabel}の決済が失敗しました。`,
      });
    } catch (e: any) {
      this.logger.warn(
        `notification failed (payment_intent.payment_failed). pi.id=${pi.id}`,
        e?.message || e,
      );
    }

    this.logger.log(
      `payment_intent.payment_failed handled. pi.id=${pi.id} postId=${postId}`,
    );
  }
}
