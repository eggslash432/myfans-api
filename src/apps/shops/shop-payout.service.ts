// api/src/apps/shops/shop-payout.service.ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  PayoutStatus,
  PayoutTargetType,
  TransferKind,
} from '@prisma/client';

@Injectable()
export class ShopPayoutService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(shopId: string) {
    // ① shopの確定売上（取り分）: Transfer.kind=shop のみ
    const earnedAgg = await this.prisma.transfer.aggregate({
      where: {
        shopId,
        kind: TransferKind.shop,
      },
      _sum: {
        amountJpy: true,
      },
    });

    const totalEarned = earnedAgg._sum.amountJpy ?? 0;

    // ② すでに申請 or 承認中 or 支払済み
    const payoutAgg = await this.prisma.payout.aggregate({
      where: {
        targetType: PayoutTargetType.SHOP,
        shopId,
        payoutStatus: {
          in: [PayoutStatus.requested, PayoutStatus.approved, PayoutStatus.paid],
        },
      },
      _sum: {
        amountJpy: true,
      },
    });

    const alreadyRequested = payoutAgg._sum.amountJpy ?? 0;

    // ③ 申請可能額
    const available = Math.max(totalEarned - alreadyRequested, 0);

    return {
      totalEarned,
      alreadyRequested,
      available,
    };
  }

  async requestPayout(shopId: string, amountJpy: number, note?: string) {
    if (!Number.isFinite(amountJpy) || amountJpy <= 0) {
      throw new BadRequestException('金額が不正です');
    }

    const summary = await this.getSummary(shopId);

    if (amountJpy > summary.available) {
      throw new BadRequestException('申請可能額を超えています');
    }

    return this.prisma.payout.create({
      data: {
        targetType: PayoutTargetType.SHOP,
        shopId,
        amountJpy,
        payoutStatus: PayoutStatus.requested,
        note,
      },
    });
  }
}
