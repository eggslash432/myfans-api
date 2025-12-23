import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PayoutStatus, PayoutTargetType } from '@prisma/client';
import Stripe from 'stripe';

function formatDate(d: Date) {
  return d.toISOString().replace('T', ' ').slice(0, 16);
}

function toCsv(rows: (string | number)[][]): string {
  return rows
    .map((r) =>
      r
        .map((v) =>
          `"${String(v).replace(/"/g, '""')}"`,
        )
        .join(','),
    )
    .join('\n');
}  

@Injectable()
export class PayoutsService {
  private stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2023-10-16' as any,
  });

  constructor(private readonly prisma: PrismaService) {}

  // =========================
  // 共通：CREATOR 残高計算
  // =========================
  async getCreatorBalanceJpy(creatorId: string): Promise<number> {
    // ① creator の確定売上（paid のみ）
    const incomeAgg = await this.prisma.payment.aggregate({
      where: {
        creatorId,
        paymentStatus: 'paid',
      },
      _sum: {
        creatorAmountJpy: true,
      },
    });

    const totalIncome = incomeAgg._sum?.creatorAmountJpy ?? 0;

    // ② 既に申請・承認・支払済みの出金
    const payoutAgg = await this.prisma.payout.aggregate({
      where: {
        targetType: 'CREATOR',
        creatorId,
        payoutStatus: {
          in: ['requested', 'approved', 'paid'],
        },
      },
      _sum: {
        amountJpy: true,
      },
    });

    const alreadyRequested = payoutAgg._sum?.amountJpy ?? 0;

    return Math.max(totalIncome - alreadyRequested, 0);
  }

  // =========================
  // CREATOR：出金申請
  // =========================
  async requestCreatorPayout(
    creatorId: string,
    amountJpy: number,
    note?: string,
  ) {
    if (!Number.isFinite(amountJpy) || amountJpy <= 0) {
      throw new BadRequestException('金額が不正です');
    }

    const available = await this.getCreatorBalanceJpy(creatorId);
    if (amountJpy > available) {
      throw new BadRequestException(
        `出金可能額を超えています（出金可能: ${available} 円）`,
      );
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

    return {
      payout,
      availableAfter: available - amountJpy,
    };
  }

  // =========================
  // CREATOR：自分の出金履歴
  // =========================
  async listCreatorPayouts(creatorId: string) {
    return this.prisma.payout.findMany({
      where: {
        targetType: 'CREATOR',
        creatorId,
      },
      orderBy: { requestedAt: 'desc' },
    });
  }

  // =========================
  // ADMIN：出金申請一覧（統合）
  // =========================
  async adminListPayouts(params: {
    status?: PayoutStatus;
    targetType?: PayoutTargetType;
  }) {
    const { status, targetType } = params;

    return this.prisma.payout.findMany({
      where: {
        ...(status ? { payoutStatus: status } : {}),
        ...(targetType ? { targetType } : {}),
      },
      orderBy: { requestedAt: 'desc' },
      include: {
        creator: {
          select: {
            userId: true,
            publicName: true,
            stripeAccountId: true,
          },
        },
        shop: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
  }

  // =========================
  // ADMIN：承認（Stripe Transfer）
  // =========================
  async adminApprove(payoutId: string) {
    const payout = await this.prisma.payout.findUnique({
      where: { id: payoutId },
      include: {
        creator: true,
        shop: true,
      },
    });

    if (!payout) throw new NotFoundException('payout not found');
    if (payout.payoutStatus !== 'requested') {
      throw new BadRequestException('この出金は承認待ちではありません');
    }

    // ---- CREATOR 出金 ----
    if (payout.targetType === 'CREATOR') {
      const creator = payout.creator;
      if (!creator?.stripeAccountId) {
        throw new BadRequestException(
          'このクリエイターには Stripe アカウントが連携されていません',
        );
      }

      const transfer = await this.stripe.transfers.create({
        amount: payout.amountJpy * 100, // JPY
        currency: 'jpy',
        destination: creator.stripeAccountId,
        description: `Creator payout ${payout.id}`,
      });

      return this.prisma.payout.update({
        where: { id: payout.id },
        data: {
          payoutStatus: 'paid',
          paidAt: new Date(),
          note: `transferId=${transfer.id}`,
        },
      });
    }

    // ---- SHOP 出金（将来拡張）----
    if (payout.targetType === 'SHOP') {
      throw new BadRequestException('SHOP 出金は未実装です');
    }

    throw new BadRequestException('Invalid payout target');
  }

  // =========================
  // ADMIN：却下
  // =========================
  async adminReject(payoutId: string, note?: string) {
    const payout = await this.prisma.payout.findUnique({
      where: { id: payoutId },
    });
    if (!payout) throw new NotFoundException('payout not found');

    if (payout.payoutStatus !== 'requested') {
      throw new BadRequestException('この出金は承認待ちではありません');
    }

    return this.prisma.payout.update({
      where: { id: payoutId },
      data: {
        payoutStatus: 'rejected',
        note,
      },
    });
  }

  // =========================
  // ADMIN：支払済みにする（Webhook等用）
  // =========================
  async adminMarkPaid(payoutId: string, note?: string) {
    const payout = await this.prisma.payout.findUnique({
      where: { id: payoutId },
    });
    if (!payout) throw new NotFoundException('payout not found');

    if (payout.payoutStatus !== 'approved') {
      throw new BadRequestException('approved 状態のみ paid にできます');
    }

    return this.prisma.payout.update({
      where: { id: payoutId },
      data: {
        payoutStatus: 'paid',
        paidAt: new Date(),
        note,
      },
    });
  }

  async getShopBalanceJpy(shopId: string): Promise<number> {
    // ① shopの確定売上（SHOP取り分）
    const incomeAgg = await this.prisma.transfer.aggregate({
      where: { shopId },
      _sum: { amountJpy: true },
    });
    const totalIncome = incomeAgg._sum?.amountJpy ?? 0;

    // ② 申請中/承認済/支払済 を差し引く
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

  async requestShopPayout(
    shopId: string,
    amountJpy: number,
    note?: string,
  ) {
    if (!Number.isFinite(amountJpy) || amountJpy <= 0) {
      throw new BadRequestException('金額が不正です');
    }

    const available = await this.getShopBalanceJpy(shopId);
    if (amountJpy > available) {
      throw new BadRequestException(
        `出金可能額を超えています（出金可能: ${available} 円）`,
      );
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

  async exportPayoutCsv(month?: string): Promise<string> {
    let from: Date | undefined;
    let to: Date | undefined;

    if (month) {
      // month = "2025-01"
      from = new Date(`${month}-01T00:00:00`);
      to = new Date(from);
      to.setMonth(to.getMonth() + 1);
    }

    const payouts = await this.prisma.payout.findMany({
      where: {
        ...(from && to
          ? {
              requestedAt: {
                gte: from,
                lt: to,
              },
            }
          : {}),
      },
      include: {
        creator: {
          select: { publicName: true },
        },
        shop: {
          select: { name: true },
        },
      },
      orderBy: { requestedAt: 'asc' },
    });

    const rows = payouts.map((p) => {
      const targetName =
        p.targetType === 'SHOP'
          ? p.shop?.name ?? ''
          : p.creator?.publicName ?? '';

      return [
        p.id,
        p.targetType,
        targetName,
        p.amountJpy,
        p.payoutStatus,
        formatDate(p.requestedAt),
        p.paidAt ? formatDate(p.paidAt) : '',
        p.note ?? '',
      ];
    });

    return toCsv(
      [
        [
          'payout_id',
          'target_type',
          'target_name',
          'amount_jpy',
          'status',
          'requested_at',
          'paid_at',
          'note',
        ],
        ...rows,
      ],
    );
  }
}
