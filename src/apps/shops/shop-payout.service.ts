// api/src/apps/shops/shop-payout.service.ts
import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class ShopPayoutService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(shopId: string) {
    // ① shopの確定売上（取り分）
    const earnedAgg = await this.prisma.transfer.aggregate({
      where: {
        shopId,
      },
      _sum: {
        amountJpy: true,
      },
    })

    const totalEarned = earnedAgg._sum?.amountJpy ?? 0

    // ② すでに申請 or 支払済み
    const payoutAgg = await this.prisma.payout.aggregate({
      where: {
        targetType: 'SHOP',
        shopId,
        payoutStatus: {
          in: ['requested', 'approved', 'paid'],
        },
      },
      _sum: {
        amountJpy: true,
      },
    })

    const alreadyRequested = payoutAgg._sum?.amountJpy ?? 0

    // ③ 申請可能額
    const available = Math.max(totalEarned - alreadyRequested, 0)

    return {
      totalEarned,
      alreadyRequested,
      available,
    }
  }

  async requestPayout(
    shopId: string,
    amountJpy: number,
    note?: string,
  ) {
    const summary = await this.getSummary(shopId)

    if (amountJpy > summary.available) {
      throw new Error('申請可能額を超えています')
    }

    return this.prisma.payout.create({
      data: {
        targetType: 'SHOP',
        shopId,
        amountJpy,
        payoutStatus: 'requested',
        note,
      },
    })
  }  
}
