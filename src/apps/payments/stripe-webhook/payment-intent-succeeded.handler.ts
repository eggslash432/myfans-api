// api/src/apps/payments/stripe-webhook/payment-intent-succeeded.handler.ts
import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentsService } from '../payments.service';
import { SplitTransferService } from './split-transfer.service';

@Injectable()
export class PaymentIntentSucceededHandler {
  private readonly logger = new Logger(PaymentIntentSucceededHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly splitTransfers: SplitTransferService,
  ) {}

  async handle(pi: Stripe.PaymentIntent) {
    const m = pi.metadata || {};
    const userId = m.userId as string | undefined;
    const postId = m.postId as string | undefined;
    const creatorIdMeta = m.creatorId as string | undefined;

    if (!userId || !postId) {
      this.logger.warn(`PI succeeded but missing metadata. pi.id=${pi.id}`);
      return;
    }

    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      select: { id: true, creatorId: true },
    });
    if (!post) {
      this.logger.warn(`Post not found for PPV purchase: ${postId}`);
      return;
    }

    const amountJpy =
      typeof pi.amount_received === 'number' ? pi.amount_received : 0;
    if (!amountJpy) {
      this.logger.warn(`PI succeeded but amount_received is 0. pi.id=${pi.id}`);
      return;
    }

    const resolvedCreatorId = creatorIdMeta ?? post.creatorId ?? undefined;
    if (!resolvedCreatorId) {
      this.logger.warn(`PI succeeded but creatorId is missing. pi.id=${pi.id}`);
      return;
    }

    const shopId = (pi.metadata?.shopId as string | undefined) ?? null;
    const chargeId = typeof pi.latest_charge === 'string' ? pi.latest_charge : null;

    // ✅ 先に Payment を作る
    const payment = await this.payments.createPaymentWithShareIdempotentV2({
      userId,
      creatorId: resolvedCreatorId,
      planId: null,
      postId,
      amountJpy,
      kind: 'one_time',
      externalTxId: pi.id,
    });

    // ✅ その後 Transfer
    await this.splitTransfers.createSplitTransfers({
      paymentId: payment.id,
      externalTxId: pi.id,
      amountJpy,
      creatorId: resolvedCreatorId,
      shopId,
      chargeId,
    });

    // Access は upsert なので安全
    await this.prisma.postAccess.upsert({
      where: { userId_postId: { userId, postId } },
      create: { userId, postId, expiresAt: null },
      update: {},
    });

    this.logger.log(`PPV unlocked: user=${userId}, post=${postId} pi=${pi.id}`);
  }
}
