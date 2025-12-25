// api/src/apps/payments/payouts-requests.service.ts

import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PayoutsBalanceService } from './payouts-balance.service';
import { PayoutStatus, PayoutTargetType } from '@prisma/client';

@Injectable()
export class PayoutsRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly balance: PayoutsBalanceService,
  ) {}

  /**
   * クリエイター出金申請
   * ✅ フェーズ1前提：creatorUserId = User.id（= Creator.userId）
   */
  async requestCreatorPayout(
    creatorUserId: string,
    amountJpy: number,
    note?: string,
  ) {
    const amount = Math.floor(Number(amountJpy));
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('金額が不正です');
    }

    const available = await this.balance.getCreatorBalanceJpy(creatorUserId);
    if (amount > available) {
      throw new BadRequestException(
        `出金可能額を超えています（出金可能: ${available} 円）`,
      );
    }

    const payout = await this.prisma.payout.create({
      data: {
        targetType: PayoutTargetType.CREATOR,
        creatorId: creatorUserId,
        amountJpy: amount,
        payoutStatus: PayoutStatus.requested,
        note,
      },
    });

    return { payout, availableAfter: Math.max(available - amount, 0) };
  }

  /**
   * 自分の出金履歴（クリエイター）
   */
  async listCreatorPayouts(creatorUserId: string) {
    return this.prisma.payout.findMany({
      where: { targetType: PayoutTargetType.CREATOR, creatorId: creatorUserId },
      orderBy: { requestedAt: 'desc' },
    });
  }

  /**
   * ショップ出金申請
   */
  async requestShopPayout(shopId: string, amountJpy: number, note?: string) {
    const amount = Math.floor(Number(amountJpy));
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('金額が不正です');
    }

    const available = await this.balance.getShopBalanceJpy(shopId);
    if (amount > available) {
      throw new BadRequestException(
        `出金可能額を超えています（出金可能: ${available} 円）`,
      );
    }

    const payout = await this.prisma.payout.create({
      data: {
        targetType: PayoutTargetType.SHOP,
        shopId,
        amountJpy: amount,
        payoutStatus: PayoutStatus.requested,
        note,
      },
    });

    return { payout, availableAfter: Math.max(available - amount, 0) };
  }

  /**
   * ショップの出金履歴
   */
  async listShopPayouts(shopId: string) {
    return this.prisma.payout.findMany({
      where: { targetType: PayoutTargetType.SHOP, shopId },
      orderBy: { requestedAt: 'desc' },
    });
  }
}
