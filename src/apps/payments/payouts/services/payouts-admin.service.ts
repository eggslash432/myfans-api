// api/src/apps/payments/payouts-admin.service.ts

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PayoutStatus, PayoutTargetType, Prisma } from '@prisma/client';
import { PrismaService } from 'src/apps/prisma/prisma.service';
import Stripe from 'stripe';
import { AdminPayoutsQueryDto } from '../../dto/admin-payouts.query';


function formatDate(d: Date) {
  return d.toISOString().replace('T', ' ').slice(0, 16);
}

function toCsv(rows: (string | number)[][]): string {
  return rows
    .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\n');
}

function parseMonthRange(month?: string): { from?: Date; to?: Date } {
  if (!month) return {};
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

    const orderBy: Prisma.PayoutOrderByWithRelationInput[] = [
      { [sortBy]: sortDir } as any,
      { id: 'desc' },
    ];

    const [total, items] = await this.prisma.$transaction([
      this.prisma.payout.count({ where }),
      this.prisma.payout.findMany({
        where,
        orderBy,
        skip,
        take,
        include: {
          creator: {
            select: { userId: true, publicName: true, stripeAccountId: true },
          },
          shop: { select: { id: true, name: true, stripeAccountId: true } },
        },
      }),
    ]);

    return { page, pageSize, total, items };
  }

  /**
   * 管理者：承認（案A）
   * ✅ requested → approved（DBで先に状態確定して競合を潰す）
   * ✅ Stripe transfer を投げる
   * ✅ paid は transfer.created(webhook) で確定
   *
   * 失敗時：
   * - approved を requested に戻す（ロールバック代替）
   */
  async adminApprove(payoutId: string) {
    // まず対象を取得（Stripe送金先の確認用）
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

      // ✅ 1) 先に approved に更新（requested のまま Stripe を叩くと二重実行の余地が出る）
      // 条件付きupdateで「今requestedのときだけ」更新する（楽観ロック）
      const updated = await this.prisma.payout.updateMany({
        where: { id: payout.id, payoutStatus: PayoutStatus.requested },
        data: { payoutStatus: PayoutStatus.approved },
      });

      if (updated.count !== 1) {
        // 競合や二重クリック等で status が変わった
        throw new BadRequestException('この出金は既に処理中、または状態が変更されています');
      }

      // ✅ 2) Stripe transfer
      try {
        const transfer = await this.stripe.transfers.create(
          {
            amount: payout.amountJpy, // ✅ JPYは円単位
            currency: 'jpy',
            destination: creator.stripeAccountId,
            description: `Payout ${payout.id}`, // webhook fallback 用の保険
            metadata: {
              payoutId: payout.id,
              targetType: 'CREATOR',
              creatorUserId: creator.userId,
            },
          },
          { idempotencyKey: `payout_${payout.id}` },
        );

        // ✅ 3) transferId を控える（既存noteがあっても追記）
        const nextNote = payout.note
          ? payout.note.includes(`transferId=${transfer.id}`)
            ? payout.note
            : `${payout.note}\ntransferId=${transfer.id}`
          : `transferId=${transfer.id}`;

        return await this.prisma.payout.update({
          where: { id: payout.id },
          data: { note: nextNote },
        });
      } catch (e: any) {
        // ✅ Stripe失敗 → approved を requested に戻す（運用事故を減らす）
        await this.prisma.payout.updateMany({
          where: { id: payout.id, payoutStatus: PayoutStatus.approved },
          data: { payoutStatus: PayoutStatus.requested },
        });

        throw new BadRequestException(
          `Stripe transfer failed: ${e?.message ?? String(e)}`,
        );
      }
    }

    if (payout.targetType === PayoutTargetType.SHOP) {
      throw new BadRequestException('SHOP 出金は未実装です');
    }

    throw new BadRequestException('Invalid payout target');
  }

  async adminReject(payoutId: string, note?: string) {
    const payout = await this.prisma.payout.findUnique({
      where: { id: payoutId },
    });
    if (!payout) throw new NotFoundException('payout not found');

    if (payout.payoutStatus !== PayoutStatus.requested) {
      throw new BadRequestException('この出金は承認待ちではありません');
    }

    return this.prisma.payout.update({
      where: { id: payoutId },
      data: { payoutStatus: PayoutStatus.rejected, note },
    });
  }

  async adminMarkPaid(payoutId: string, note?: string) {
    const payout = await this.prisma.payout.findUnique({
      where: { id: payoutId },
    });
    if (!payout) throw new NotFoundException('payout not found');

    if (payout.payoutStatus !== PayoutStatus.approved) {
      throw new BadRequestException('approved 状態のみ paid にできます');
    }

    return this.prisma.payout.update({
      where: { id: payoutId },
      data: { payoutStatus: PayoutStatus.paid, paidAt: new Date(), note },
    });
  }

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
