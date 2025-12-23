// api/src/apps/payments/payouts-balance.service.ts

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentStatus, Prisma } from '@prisma/client';

@Injectable()
export class PayoutsBalanceService {
  constructor(private readonly prisma: PrismaService) {}

  async getCreatorBalanceJpy(creatorId: string): Promise<number> {
    const incomeRows = await this.prisma.$queryRaw<
      Array<{ totalIncome: bigint | number | null }>
    >(Prisma.sql`
      SELECT COALESCE(SUM(COALESCE("creatorAmountJpy", "amountJpy")), 0) AS "totalIncome"
      FROM "Payment"
      WHERE "creatorId" = ${creatorId}
        AND "paymentStatus"::text = ${PaymentStatus.paid}::text
    `);

    const incomeVal = incomeRows?.[0]?.totalIncome ?? 0;
    const totalIncome = typeof incomeVal === 'bigint' ? Number(incomeVal) : Number(incomeVal);

    const payoutAgg = await this.prisma.payout.aggregate({
      where: {
        targetType: 'CREATOR',
        creatorId,
        payoutStatus: { in: ['requested', 'approved', 'paid'] },
      },
      _sum: { amountJpy: true },
    });

    const alreadyRequested = payoutAgg._sum?.amountJpy ?? 0;
    return Math.max(totalIncome - alreadyRequested, 0);
  }

  async getShopBalanceJpy(shopId: string): Promise<number> {
    const incomeAgg = await this.prisma.transfer.aggregate({
      where: { shopId },
      _sum: { amountJpy: true },
    });
    const totalIncome = incomeAgg._sum?.amountJpy ?? 0;

    const payoutAgg = await this.prisma.payout.aggregate({
      where: {
        targetType: 'SHOP',
        shopId,
        payoutStatus: { in: ['requested', 'approved', 'paid'] },
      },
      _sum: { amountJpy: true },
    });
    const alreadyRequested = payoutAgg._sum?.amountJpy ?? 0;

    return Math.max(totalIncome - alreadyRequested, 0);
  }
}
