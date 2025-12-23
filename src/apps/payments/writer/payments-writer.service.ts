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

  /**
   * creatorId が
   * - creator.userId
   * - creator.id
   * のどちらで来ても shopId を解決する
   */
  private async resolveShopId(creatorId: string): Promise<string | null> {
    // ① creator.userId として探す
    let creator = await this.prisma.creator.findUnique({
      where: { userId: creatorId },
      select: { shopId: true },
    });

    if (creator?.shopId) {
      return creator.shopId;
    }

    // ② creator.id（PK）として探す（フォールバック）
    creator = await this.prisma.creator.findUnique({
      where: { userId: creatorId },
      select: { shopId: true },
    });

    if (creator?.shopId) {
      return creator.shopId;
    }

    // ③ 見つからなかった場合はログ
    this.logger.warn(
      `resolveShopId: shopId not found. creatorId=${creatorId}`,
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
