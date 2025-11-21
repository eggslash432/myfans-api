// src/apps/payments/payouts.service.ts
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentStatus, PayoutStatus } from '@prisma/client';
import Stripe from 'stripe';

@Injectable()
export class PayoutsService {
  private stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2023-10-16' as any,
  });

  constructor(private prisma: PrismaService) {}

  /**
   * クリエイターの現在引き出せる残高（円）を算出
   */
  async getCreatorBalanceJpy(creatorUserId: string): Promise<number> {
    // 1) 支払済み売上合計
    // ★ クリエイター取り分だけ合計する
    const paidAgg = await this.prisma.payment.aggregate({
      where: {
        creatorId: creatorUserId,
        paymentStatus: PaymentStatus.paid,
      },
      _sum: { creatorAmountJpy: true },
    });
    const totalIncome = paidAgg._sum.creatorAmountJpy ?? 0;

    // 2) すでに出金に回した合計（requested / approved / paid）
    const usedAgg = await this.prisma.payout.aggregate({
      where: {
        creatorId: creatorUserId,
        payoutStatus: {
          in: [
            PayoutStatus.requested,
            PayoutStatus.approved,
            PayoutStatus.paid,
          ],
        },
      },
      _sum: { amountJpy: true },
    });
    const alreadyRequested = usedAgg._sum.amountJpy ?? 0;

    const available = totalIncome - alreadyRequested;
    return available > 0 ? available : 0;
  }

  /**
   * クリエイターが出金リクエストを行う
   */
  async requestPayout(creatorUserId: string, amountJpy: number) {
    if (!Number.isFinite(amountJpy) || amountJpy <= 0) {
      throw new BadRequestException('金額が不正です');
    }

    const available = await this.getCreatorBalanceJpy(creatorUserId);
    if (amountJpy > available) {
      throw new BadRequestException(
        `出金可能額を超えています（出金可能: ${available} 円）`,
      );
    }

    const payout = await this.prisma.payout.create({
      data: {
        creatorId: creatorUserId,
        amountJpy: Math.floor(amountJpy),
        payoutStatus: PayoutStatus.requested,
      },
    });

    return { payout, availableAfter: available - amountJpy };
  }

  /**
   * 管理者: 出金リクエスト一覧
   */
  async adminListPayouts(status?: PayoutStatus) {
    return this.prisma.payout.findMany({
      where: status ? { payoutStatus: status } : undefined,
      orderBy: { requestedAt: 'desc' },
      include: {
        creator: {
          select: {
            userId: true,
            publicName: true,
            stripeAccountId: true,
          },
        },
      },
    });
  }

  /**
   * 管理者: 出金リクエストを承認し、Stripe Connect に transfer を飛ばす
   * （シンプル版：同期で transfer → paid にしてしまう）
   */
  async adminApproveAndTransfer(payoutId: string, adminUserId: string) {
    const payout = await this.prisma.payout.findUnique({
      where: { id: payoutId },
      include: {
        creator: true,
      },
    });
    if (!payout) throw new NotFoundException('payout not found');

    if (payout.payoutStatus !== PayoutStatus.requested) {
      throw new BadRequestException('この出金は承認待ちではありません');
    }

    const creator = payout.creator;
    if (!creator?.stripeAccountId) {
      throw new BadRequestException(
        'このクリエイターには Stripe アカウントが連携されていません',
      );
    }

    // Stripe transfer 実行（プラットフォーム口座 → クリエイターConnectアカウント）
    const transfer = await this.stripe.transfers.create({
      amount: payout.amountJpy * 100, // JPY → セント
      currency: 'jpy',
      destination: creator.stripeAccountId,
      description: `Payout for creator ${creator.userId} / payoutId=${payout.id}`,
    });

    // ここではそのまま paid にする（asyncにしたいなら approved → webhook で paid に）
    const updated = await this.prisma.payout.update({
      where: { id: payout.id },
      data: {
        payoutStatus: PayoutStatus.paid,
        paidAt: new Date(),
        note: `transferId=${transfer.id}`,
      },
    });

    return updated;
  }

  /**
   * 管理者: 出金リクエストを却下
   */
  async adminReject(payoutId: string, adminUserId: string, note?: string) {
    const payout = await this.prisma.payout.findUnique({
      where: { id: payoutId },
    });
    if (!payout) throw new NotFoundException('payout not found');

    if (payout.payoutStatus !== PayoutStatus.requested) {
      throw new BadRequestException('この出金は承認待ちではありません');
    }

    return this.prisma.payout.update({
      where: { id: payoutId },
      data: {
        payoutStatus: PayoutStatus.rejected,
        note,
      },
    });
  }
}
