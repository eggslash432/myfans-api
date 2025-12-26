// api/src/apps/payments/stripe-webhook/payment-intent-succeeded.handler.ts
import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../../../prisma/prisma.service';
import { SplitTransferService } from '../transfer/split-transfer.service';
import { PaymentsWriterService } from '../../writer/payments-writer.service';
import { ConfigService } from '@nestjs/config';
import { NotificationsService } from '../../../notifications/notifications.service'; // ✅ 追加

@Injectable()
export class PaymentIntentSucceededHandler {
  private readonly logger = new Logger(PaymentIntentSucceededHandler.name);
  private readonly stripe: Stripe;

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentsWriter: PaymentsWriterService,
    private readonly splitTransfers: SplitTransferService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService, // ✅ 追加
  ) {
    const secret =
      this.config.get<string>('STRIPE_SECRET_KEY') ?? process.env.STRIPE_SECRET_KEY;
    if (!secret) {
      throw new Error('STRIPE_SECRET_KEY is not set');
    }
    this.stripe = new Stripe(secret, {});
  }

  async handle(pi: Stripe.PaymentIntent) {
    const m = pi.metadata || {};

    const userId = (m.userId as string | undefined) ?? undefined;
    const postId = (m.postId as string | undefined) ?? undefined;

    // PPVは postId 前提運用（ここが無いと正しく creator/shop を確定できない）
    if (!userId || !postId) {
      this.logger.warn(
        `PI succeeded but missing metadata. pi.id=${pi.id} userId=${userId} postId=${postId}`,
      );
      return;
    }

    // post から creatorId（= creator.userId）を確定させる（metadata.creatorId は信用しない）
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      select: { id: true, creatorId: true, title: true }, // ✅ title追加
    });
    if (!post?.creatorId) {
      this.logger.warn(`Post not found or missing creatorId: postId=${postId}`);
      return;
    }

    // amount_received は Stripe の最終金額（基本これが正）
    const amountJpy =
      typeof pi.amount_received === 'number' ? pi.amount_received : 0;

    if (!amountJpy || amountJpy <= 0) {
      this.logger.warn(
        `PI succeeded but amount_received is invalid. pi.id=${pi.id} amount=${amountJpy}`,
      );
      return;
    }

    const resolvedCreatorId = post.creatorId; // ✅ これが正

    const chargeId =
      typeof pi.latest_charge === 'string' ? pi.latest_charge : null;

    // ✅ 先に Payment を作る（ここで shopId も確定させる）
    const payment = await this.paymentsWriter.createPaymentWithShareIdempotent({
      userId,
      creatorId: resolvedCreatorId,
      planId: null,
      postId,
      amountJpy,
      kind: 'one_time',
      externalTxId: pi.id,
    });

    if (!payment) return;

    // ✅ stripeFeeJpy を保存（冪等）
    await this.tryUpdateStripeFeeJpy(
      payment.id,
      payment.stripeFeeJpy ?? null,
      pi,
      chargeId,
    );

    // ✅ shopId は payment.shopId を正とする（metadataは補助）
    const shopIdResolved =
      payment.shopId ??
      ((pi.metadata?.shopId as string | undefined) ?? null);

    // ✅ その後 Transfer
    await this.splitTransfers.createSplitTransfers({
      paymentId: payment.id,
      externalTxId: pi.id,
      amountJpy,
      creatorUserId: resolvedCreatorId,
      shopId: shopIdResolved,
      chargeId,
    });

    // ✅ Access は upsert なので安全
    await this.prisma.postAccess.upsert({
      where: { userId_postId: { userId, postId } },
      create: { userId, postId, expiresAt: null },
      update: {},
    });

    // ✅ 通知（Webhook由来）
    try {
      const postLabel = post.title ? `「${post.title}」` : '有料投稿';
      const yen = `¥${amountJpy.toLocaleString('ja-JP')}`;

      // 購入者へ
      await this.notifications.notify({
        userId,
        type: 'PAYMENT',
        source: 'WEBHOOK',
        title: '購入が完了しました',
        body: `${postLabel}の購入が完了しました（${yen}）。`,
      });

      // クリエイターへ
      await this.notifications.notify({
        userId: resolvedCreatorId,
        type: 'PAYMENT',
        source: 'WEBHOOK',
        title: '購入がありました',
        body: `${postLabel}が購入されました（${yen}）。`,
      });
    } catch (e: any) {
      this.logger.warn(
        `notification failed (payment_intent.succeeded). pi.id=${pi.id}`,
        e?.message || e,
      );
    }

    // 参考：metadataのcreatorIdがズレてたらログ（原因調査用）
    const creatorIdMeta = m.creatorId as string | undefined;
    if (creatorIdMeta && creatorIdMeta !== resolvedCreatorId) {
      this.logger.warn(
        `PI metadata.creatorId mismatch. pi.id=${pi.id} meta=${creatorIdMeta} resolved=${resolvedCreatorId}`,
      );
    }

    if (!payment.shopId && !shopIdResolved) {
      this.logger.warn(
        `PPV payment/transfer created but shopId is null. pi.id=${pi.id} paymentId=${payment.id} creatorId=${resolvedCreatorId}`,
      );
    }

    this.logger.log(
      `PPV unlocked: user=${userId}, post=${postId}, pi=${pi.id}`,
    );
  }

  private async tryUpdateStripeFeeJpy(
    paymentId: string,
    currentStripeFeeJpy: number | null,
    pi: Stripe.PaymentIntent,
    chargeId: string | null,
  ) {
    try {
      // 既に入ってるなら冪等的にスキップ
      if (typeof currentStripeFeeJpy === 'number' && currentStripeFeeJpy > 0) {
        return;
      }

      // latest_charge が無い場合は取れない（0円/特殊ケース等）
      if (!chargeId) {
        this.logger.warn(`stripe fee skipped: no chargeId. pi.id=${pi.id}`);
        return;
      }

      const charge = await this.stripe.charges.retrieve(chargeId, {
        expand: ['balance_transaction'],
      });

      const bt = charge.balance_transaction as
        | Stripe.BalanceTransaction
        | string
        | null;

      if (!bt || typeof bt === 'string') {
        this.logger.warn(
          `stripe fee skipped: balance_transaction not expanded. chargeId=${chargeId}`,
        );
        return;
      }

      // fee は最小単位。JPYなら円。
      if ((bt.currency ?? '').toLowerCase() !== 'jpy') {
        this.logger.warn(
          `stripe fee skipped: non-jpy currency. currency=${bt.currency} pi.id=${pi.id}`,
        );
        return;
      }

      const feeJpy = Number(bt.fee ?? 0);

      await this.prisma.payment.update({
        where: { id: paymentId },
        data: { stripeFeeJpy: feeJpy },
      });

      this.logger.log(
        `stripeFeeJpy updated: paymentId=${paymentId} fee=${feeJpy}`,
      );
    } catch (e: any) {
      // Webhook 全体を落とさない（冪等ログは gate 側でも残る）
      this.logger.error(
        `stripe fee update failed. pi.id=${pi.id} paymentId=${paymentId}`,
        e?.stack || e,
      );
    }
  }
}
