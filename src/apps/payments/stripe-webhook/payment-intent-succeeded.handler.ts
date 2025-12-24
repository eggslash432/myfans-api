// api/src/apps/payments/stripe-webhook/payment-intent-succeeded.handler.ts
import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../../prisma/prisma.service';
import { SplitTransferService } from './split-transfer.service';
import { PaymentsWriterService } from '../writer/payments-writer.service';

@Injectable()
export class PaymentIntentSucceededHandler {
  private readonly logger = new Logger(PaymentIntentSucceededHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentsWriter: PaymentsWriterService,
    private readonly splitTransfers: SplitTransferService,
  ) {}

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
      select: { id: true, creatorId: true },
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

    // ✅ shopId は payment.shopId を正とする（metadataは補助）
    const shopIdResolved =
      payment.shopId ??
      ((pi.metadata?.shopId as string | undefined) ?? null);

    // ✅ その後 Transfer
    await this.splitTransfers.createSplitTransfers({
      paymentId: payment.id,
      externalTxId: pi.id,
      amountJpy,
      creatorId: resolvedCreatorId,
      shopId: shopIdResolved,
      chargeId,
    });

    // ✅ Access は upsert なので安全
    await this.prisma.postAccess.upsert({
      where: { userId_postId: { userId, postId } },
      create: { userId, postId, expiresAt: null },
      update: {},
    });

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
}
