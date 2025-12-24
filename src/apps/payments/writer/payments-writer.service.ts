// api/src/apps/payments/writer/payments-writer.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/apps/prisma/prisma.service';
import { PaymentShareService } from '../share/payment-share.service';
import { CreatePaymentWithShareArgs } from 'src/shared/types';

@Injectable()
export class PaymentsWriterService {
  private readonly logger = new Logger(PaymentsWriterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly share: PaymentShareService,
  ) {}

  private async resolveShopId(creatorUserId: string): Promise<string | null> {
    const creator = await this.prisma.creator.findUnique({
      where: { userId: creatorUserId },
      select: { shopId: true },
    });

    if (creator?.shopId) return creator.shopId;

    this.logger.warn(
      `resolveShopId: shopId not found. creatorUserId=${creatorUserId}`,
    );
    return null;
  }


  async createPaymentWithShareIdempotent(
    args: CreatePaymentWithShareArgs,
  ) {
    const {
      externalTxId,
      amountJpy,
      creatorId,
      userId,
      planId,
      postId,
      kind,
    } = args;

    try {
      const fee = await this.share.getFeeSetting();
      const split = this.share.split(amountJpy, fee);

      const shopId = await this.resolveShopId(creatorId);

      const payment = await this.prisma.payment.create({
        data: {
          externalTxId,
          userId,
          creatorId,
          shopId, // ← ★必ず入る（null なら原因ログあり）
          planId,
          postId,
          kind,
          amountJpy,
          paymentStatus: 'paid',
          paidAt: new Date(),

          creatorAmountJpy: split.creatorAmountJpy,
          shopAmountJpy: split.shopAmountJpy,
          platformAmountJpy: split.managerAmountJpy,

          managerPercent: fee.managerPercent,
          shopPercent: fee.shopPercent,
          creatorPercent: fee.creatorPercent,
        },
      });

      if (!payment.shopId) {
        this.logger.error(
          `Payment created but shopId is null. paymentId=${payment.id} creatorId=${creatorId}`,
        );
      }

      return payment;
    } catch (e: any) {
      if (e.code === 'P2002') {
        // 冪等：既存 payment を返す
        const existing = await this.prisma.payment.findUnique({
          where: { externalTxId },
        });

        if (!existing) {
          throw new Error(
            `Payment unique conflict but record not found. externalTxId=${externalTxId}`,
          );
        }

        return existing;
      }
      throw e;
    }
  }
}
