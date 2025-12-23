// api/src/apps/payments/payouts-requests.service.ts

import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PayoutsBalanceService } from './payouts-balance.service';

@Injectable()
export class PayoutsRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly balance: PayoutsBalanceService,
  ) {}

  async requestCreatorPayout(creatorId: string, amountJpy: number, note?: string) {
    if (!Number.isFinite(amountJpy) || amountJpy <= 0) {
      throw new BadRequestException('金額が不正です');
    }

    const available = await this.balance.getCreatorBalanceJpy(creatorId);
    if (amountJpy > available) {
      throw new BadRequestException(`出金可能額を超えています（出金可能: ${available} 円）`);
    }

    const payout = await this.prisma.payout.create({
      data: {
        targetType: 'CREATOR',
        creatorId,
        amountJpy: Math.floor(amountJpy),
        payoutStatus: 'requested',
        note,
      },
    });

    return { payout, availableAfter: available - amountJpy };
  }

  async listCreatorPayouts(creatorId: string) {
    return this.prisma.payout.findMany({
      where: { targetType: 'CREATOR', creatorId },
      orderBy: { requestedAt: 'desc' },
    });
  }

  async requestShopPayout(shopId: string, amountJpy: number, note?: string) {
    if (!Number.isFinite(amountJpy) || amountJpy <= 0) {
      throw new BadRequestException('金額が不正です');
    }

    const available = await this.balance.getShopBalanceJpy(shopId);
    if (amountJpy > available) {
      throw new BadRequestException(`出金可能額を超えています（出金可能: ${available} 円）`);
    }

    const payout = await this.prisma.payout.create({
      data: {
        targetType: 'SHOP',
        shopId,
        amountJpy: Math.floor(amountJpy),
        payoutStatus: 'requested',
        note,
      },
    });

    return { payout, availableAfter: available - amountJpy };
  }

  async listShopPayouts(shopId: string) {
    return this.prisma.payout.findMany({
      where: { targetType: 'SHOP', shopId },
      orderBy: { requestedAt: 'desc' },
    });
  }
}
