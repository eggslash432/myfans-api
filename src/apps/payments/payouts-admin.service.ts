// api/src/apps/payments/payouts-admin.service.ts

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  PayoutStatus,
  PayoutTargetType,
  Prisma,
} from '@prisma/client';
import Stripe from 'stripe';
import { AdminPayoutsQueryDto } from './dto/admin-payouts.query';

function formatDate(d: Date) {
  // "YYYY-MM-DD HH:mm" っぽい見やすい形（UTCで出るので運用に合わせて要調整）
  return d.toISOString().replace('T', ' ').slice(0, 16);
}

function toCsv(rows: (string | number)[][]): string {
  return rows
    .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\n');
}

function parseMonthRange(month?: string): { from?: Date; to?: Date } {
  if (!month) return {};
  // month: "2025-12" 想定
  // サーバTZ次第でズレやすいので、明示的に UTC で作る（少なくとも境界事故を減らす）
  // ※管理画面要件が「JST月次」なら、JST変換ユーティリティに寄せるのが理想
  const m = month.trim();
  if (!/^\d{4}-\d{2}$/.test(m)) {
    throw new BadRequestException('month は YYYY-MM 形式で指定してください');
  }
  const from = new Date(`${m}-01T00:00:00.000Z`);
  const to = new Date(from);
  to.setUTCMonth(to.getUTCMonth() + 1);
  return { from, to };
}

@Injectable()
export class PayoutsAdminService {
  private stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2023-10-16' as any,
  });

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 管理者：出金一覧（filter/sort/paging）
   */
  async adminListPayouts(q: AdminPayoutsQueryDto) {
    const page = q.page ?? 1;
    const pageSize = Math.min(q.pageSize ?? 50, 200);
    const skip = (page - 1) * pageSize;
    const take = pageSize;

    const where: Prisma.PayoutWhereInput = {
      ...(q.status ? { payoutStatus: q.status } : {}),
      ...(q.targetType ? { targetType: q.targetType } : {}),
    };

    const from = q.from;
    const to = q.to;

    if (from || to) {
      where.requestedAt = {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      };
    }

    const sortBy = q.sortBy ?? 'requestedAt';
    const sortDir = q.sortDir ?? 'desc';

    // sortBy は DTO で許可リスト化してる前提
    const orderBy: Prisma.PayoutOrderByWithRelationInput[] = [
      { [sortBy]: sortDir } as any,
      { id: 'desc' }, // 安定ソート
    ];

    const [total, items] = await this.prisma.$transaction([
      this.prisma.payout.count({ where }),
      this.prisma.payout.findMany({
        where,
        orderBy,
        skip,
        take,
        include: {
          creator: { select: { userId: true, publicName: true, stripeAccountId: true } },
          shop: { select: { id: true, name: true, stripeAccountId: true } },
        },
      }),
    ]);

    return { page, pageSize, total, items };
  }

  /**
   * 管理者：承認（= Stripe Transfer 実行して paid にする）
   * ※現状は "requested → paid" のワンステップ
   *   もし "approved" を挟みたいなら、ここでまず approved にしてから別ジョブにする。
   */
  async adminApprove(payoutId: string) {
    const payout = await this.prisma.payout.findUnique({
      where: { id: payoutId },
      include: { creator: true, shop: true },
    });
    if (!payout) throw new NotFoundException('payout not found');

    if (payout.payoutStatus !== PayoutStatus.requested) {
      throw new BadRequestException('この出金は承認待ちではありません');
    }

    if (payout.targetType === PayoutTargetType.CREATOR) {
      const creator = payout.creator;
      if (!creator?.stripeAccountId) {
        throw new BadRequestException(
          'このクリエイターには Stripe アカウントが連携されていません',
        );
      }

      // Stripe Transfer
      const transfer = await this.stripe.transfers.create({
        amount: payout.amountJpy * 100,
        currency: 'jpy',
        destination: creator.stripeAccountId,
        description: `Creator payout ${payout.id}`,
      });

      return this.prisma.payout.update({
        where: { id: payout.id },
        data: {
          payoutStatus: PayoutStatus.paid,
          paidAt: new Date(),
          note: `transferId=${transfer.id}`,
        },
      });
    }

    if (payout.targetType === PayoutTargetType.SHOP) {
      // 将来：shop.stripeAccountId に transfer する、など
      throw new BadRequestException('SHOP 出金は未実装です');
    }

    throw new BadRequestException('Invalid payout target');
  }

  /**
   * 管理者：却下
   */
  async adminReject(payoutId: string, note?: string) {
    const payout = await this.prisma.payout.findUnique({ where: { id: payoutId } });
    if (!payout) throw new NotFoundException('payout not found');

    if (payout.payoutStatus !== PayoutStatus.requested) {
      throw new BadRequestException('この出金は承認待ちではありません');
    }

    return this.prisma.payout.update({
      where: { id: payoutId },
      data: { payoutStatus: PayoutStatus.rejected, note },
    });
  }

  /**
   * 管理者：手動 paid マーク（approved → paid）
   * ※今の adminApprove() は requested→paid 直行なので、
   *   ここを使うケースは「別経路で approved にした」場合のみ。
   */
  async adminMarkPaid(payoutId: string, note?: string) {
    const payout = await this.prisma.payout.findUnique({ where: { id: payoutId } });
    if (!payout) throw new NotFoundException('payout not found');

    if (payout.payoutStatus !== PayoutStatus.approved) {
      throw new BadRequestException('approved 状態のみ paid にできます');
    }

    return this.prisma.payout.update({
      where: { id: payoutId },
      data: { payoutStatus: PayoutStatus.paid, paidAt: new Date(), note },
    });
  }

  /**
   * 管理者：CSV出力
   * month: "YYYY-MM" のとき requestedAt をその月で絞る
   */
  async exportPayoutCsv(month?: string): Promise<string> {
    const { from, to } = parseMonthRange(month);

    const payouts = await this.prisma.payout.findMany({
      where: {
        ...(from && to ? { requestedAt: { gte: from, lt: to } } : {}),
      },
      include: {
        creator: { select: { publicName: true } },
        shop: { select: { name: true } },
      },
      orderBy: { requestedAt: 'asc' },
    });

    const rows = payouts.map((p) => {
      const targetName =
        p.targetType === PayoutTargetType.SHOP
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

    return toCsv([
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
    ]);
  }
}
