// api/src/apps/payments/payouts-balance.service.ts

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  PaymentStatus,
  PayoutStatus,
  PayoutTargetType,
} from '@prisma/client';

@Injectable()
export class PayoutsBalanceService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * クリエイターの出金可能残高
   * - 収入: Payment(paymentStatus=paid) の creatorAmountJpy 合計（nullは0扱い）
   * - 控除: requested/approved/paid の Payout 合計
   *
   * ※案Bでも creator 側から Stripe手数料を引く運用にしないなら、このままでOK
   */
  async getCreatorBalanceJpy(creatorUserId: string): Promise<number> {
    const incomeAgg = await this.prisma.payment.aggregate({
      where: {
        creatorId: creatorUserId,
        paymentStatus: PaymentStatus.paid,
      },
      _sum: { creatorAmountJpy: true },
    });

    const totalIncome = incomeAgg._sum.creatorAmountJpy ?? 0;

    const payoutAgg = await this.prisma.payout.aggregate({
      where: {
        targetType: PayoutTargetType.CREATOR,
        creatorId: creatorUserId,
        payoutStatus: {
          in: [PayoutStatus.requested, PayoutStatus.approved, PayoutStatus.paid],
        },
      },
      _sum: { amountJpy: true },
    });

    const alreadyRequested = payoutAgg._sum.amountJpy ?? 0;
    return Math.max(totalIncome - alreadyRequested, 0);
  }

  /**
   * ショップの出金可能残高（案B：Stripe手数料は後差し引き）
   * - 収入: SUM(shopAmountJpy) - SUM(stripeFeeJpy)
   * - 控除: requested/approved/paid の Payout 合計
   */
  async getShopBalanceJpy(shopId: string): Promise<number> {
    // ✅ 収入（Paymentスナップショット）
    const incomeAgg = await this.prisma.payment.aggregate({
      where: {
        shopId,
        paymentStatus: PaymentStatus.paid,
      },
      _sum: { shopAmountJpy: true, stripeFeeJpy: true },
    });

    const shopSum = incomeAgg._sum.shopAmountJpy ?? 0;
    const feeSum = incomeAgg._sum.stripeFeeJpy ?? 0;

    // ✅ 実入金ベース（負にならないように丸め）
    const totalIncome = Math.max(shopSum - feeSum, 0);

    // ✅ 既に申請・処理中・支払い済みの出金（控除）
    const payoutAgg = await this.prisma.payout.aggregate({
      where: {
        targetType: PayoutTargetType.SHOP,
        shopId,
        payoutStatus: {
          in: [PayoutStatus.requested, PayoutStatus.approved, PayoutStatus.paid],
        },
      },
      _sum: { amountJpy: true },
    });

    const alreadyRequested = payoutAgg._sum.amountJpy ?? 0;
    return Math.max(totalIncome - alreadyRequested, 0);
  }
}
