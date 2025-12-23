// api/src/apps/payments/payouts-admin.service.ts

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PayoutStatus, PayoutTargetType } from '@prisma/client';
import Stripe from 'stripe';

function formatDate(d: Date) {
  return d.toISOString().replace('T', ' ').slice(0, 16);
}
function toCsv(rows: (string | number)[][]): string {
  return rows
    .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\n');
}

@Injectable()
export class PayoutsAdminService {
  private stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2023-10-16' as any,
  });

  constructor(private readonly prisma: PrismaService) {}

  async adminListPayouts(params: { status?: PayoutStatus; targetType?: PayoutTargetType }) {
    const { status, targetType } = params;

    return this.prisma.payout.findMany({
      where: {
        ...(status ? { payoutStatus: status } : {}),
        ...(targetType ? { targetType } : {}),
      },
      orderBy: { requestedAt: 'desc' },
      include: {
        creator: { select: { userId: true, publicName: true, stripeAccountId: true } },
        shop: { select: { id: true, name: true } },
      },
    });
  }

  async adminApprove(payoutId: string) {
    const payout = await this.prisma.payout.findUnique({
      where: { id: payoutId },
      include: { creator: true, shop: true },
    });
    if (!payout) throw new NotFoundException('payout not found');
    if (payout.payoutStatus !== 'requested') {
      throw new BadRequestException('この出金は承認待ちではありません');
    }

    if (payout.targetType === 'CREATOR') {
      const creator = payout.creator;
      if (!creator?.stripeAccountId) {
        throw new BadRequestException('このクリエイターには Stripe アカウントが連携されていません');
      }

      const transfer = await this.stripe.transfers.create({
        amount: payout.amountJpy * 100,
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

    if (payout.targetType === 'SHOP') {
      throw new BadRequestException('SHOP 出金は未実装です');
    }

    throw new BadRequestException('Invalid payout target');
  }

  async adminReject(payoutId: string, note?: string) {
    const payout = await this.prisma.payout.findUnique({ where: { id: payoutId } });
    if (!payout) throw new NotFoundException('payout not found');
    if (payout.payoutStatus !== 'requested') {
      throw new BadRequestException('この出金は承認待ちではありません');
    }
    return this.prisma.payout.update({
      where: { id: payoutId },
      data: { payoutStatus: 'rejected', note },
    });
  }

  async adminMarkPaid(payoutId: string, note?: string) {
    const payout = await this.prisma.payout.findUnique({ where: { id: payoutId } });
    if (!payout) throw new NotFoundException('payout not found');
    if (payout.payoutStatus !== 'approved') {
      throw new BadRequestException('approved 状態のみ paid にできます');
    }
    return this.prisma.payout.update({
      where: { id: payoutId },
      data: { payoutStatus: 'paid', paidAt: new Date(), note },
    });
  }

  async exportPayoutCsv(month?: string): Promise<string> {
    let from: Date | undefined;
    let to: Date | undefined;

    if (month) {
      from = new Date(`${month}-01T00:00:00`);
      to = new Date(from);
      to.setMonth(to.getMonth() + 1);
    }

    const payouts = await this.prisma.payout.findMany({
      where: {
        ...(from && to
          ? { requestedAt: { gte: from, lt: to } }
          : {}),
      },
      include: {
        creator: { select: { publicName: true } },
        shop: { select: { name: true } },
      },
      orderBy: { requestedAt: 'asc' },
    });

    const rows = payouts.map((p) => {
      const targetName = p.targetType === 'SHOP' ? p.shop?.name ?? '' : p.creator?.publicName ?? '';
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

    return toCsv([
      ['payout_id', 'target_type', 'target_name', 'amount_jpy', 'status', 'requested_at', 'paid_at', 'note'],
      ...rows,
    ]);
  }
}
