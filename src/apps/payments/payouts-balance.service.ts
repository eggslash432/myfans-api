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
   * - 収入: Payment(paymentStatus=paid) の creatorAmountJpy の合計（nullは0扱い）
   * - 控除: すでに requested/approved/paid の Payout 合計
   */
  async getCreatorBalanceJpy(creatorId: string): Promise<number> {
    // ✅ 収入（creatorAmountJpy だけを見る。nullは0）
    const incomeAgg = await this.prisma.payment.aggregate({
      where: {
        creatorId,
        paymentStatus: PaymentStatus.paid,
      },
      _sum: {
        creatorAmountJpy: true,
      },
    });

    const totalIncome = incomeAgg._sum.creatorAmountJpy ?? 0;

    // ✅ 既に申請・処理中・支払い済みの出金
    const payoutAgg = await this.prisma.payout.aggregate({
      where: {
        targetType: PayoutTargetType.CREATOR,
        creatorId,
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
   * ショップの出金可能残高
   * - 収入: Transfer(kind=shop) の合計（※今は transfer 全部合計になってるので注意）
   * - 控除: requested/approved/paid の Payout 合計
   */
  async getShopBalanceJpy(shopId: string): Promise<number> {
    // ⚠️ ここ、現状 Transfer を全合計してるので、
    //   platform/creator の transfer も入っている設計ならバグになる。
    //   kind=shop に寄せるのが基本。
    const incomeAgg = await this.prisma.transfer.aggregate({
      where: {
        shopId,
        kind: 'shop' as any, // ← TransferKind.shop を importして使うのが正解（後述）
      },
      _sum: { amountJpy: true },
    });

    const totalIncome = incomeAgg._sum.amountJpy ?? 0;

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
