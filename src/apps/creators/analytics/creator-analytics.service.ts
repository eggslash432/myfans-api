// api/src/apps/creators/analytics/creator-analytics.service.ts

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentStatus, Prisma, SubStatus } from '@prisma/client';
import { endExclusive, parseYmd } from '../creators.utils';

@Injectable()
export class CreatorAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getMySimpleAnalytics(userId: string) {
    // ✅ FIX: creatorAmountJpy が NULL の過去データでも売上が 0 にならないように
    //        SUM(COALESCE(creatorAmountJpy, amountJpy)) を queryRaw で取得する
    const rows = await this.prisma.$queryRaw<
      Array<{ revenueJpy: bigint | number | null }>
    >(Prisma.sql`
      SELECT
        COALESCE(SUM(COALESCE("creatorAmountJpy", "amountJpy")), 0) AS "revenueJpy"
      FROM "Payment"
      WHERE "creatorId" = ${userId}
        AND "paymentStatus"::text = ${PaymentStatus.paid}::text
    `);

    const v = rows?.[0]?.revenueJpy ?? 0;
    const totalRevenueJpy = typeof v === 'bigint' ? Number(v) : Number(v);

    const totalSubscribers = await this.prisma.subscription.count({
      where: {
        creatorId: userId,
        status: { in: ['active', 'trialing'] as any },
      },
    });

    return { totalRevenueJpy, totalSubscribers };
  }

  async getMyRevenueTrend(
    userId: string,
    params: { granularity: 'day' | 'month'; from?: string; to?: string },
  ) {
    const g = params.granularity ?? 'day';
    const from =
      parseYmd(params.from) ?? new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const toEx =
      endExclusive(params.to) ?? new Date(Date.now() + 1 * 24 * 3600 * 1000);

    const trunc =
      g === 'month'
        ? Prisma.sql`date_trunc('month', "paidAt")`
        : Prisma.sql`date_trunc('day', "paidAt")`;
    const fmt =
      g === 'month'
        ? Prisma.sql`to_char(${trunc}, 'YYYY-MM')`
        : Prisma.sql`to_char(${trunc}, 'YYYY-MM-DD')`;

    // ★ enum は text 比較に倒すのが安全（schema/public 依存消える）
    const rows = await this.prisma.$queryRaw<
      Array<{ date: string; revenueJpy: bigint }>
    >(Prisma.sql`
      SELECT
        ${fmt} AS "date",
        SUM(COALESCE("creatorAmountJpy", "amountJpy"))::bigint AS "revenueJpy"
      FROM "Payment"
      WHERE "creatorId" = ${userId}
        AND "paymentStatus"::text = ${PaymentStatus.paid}::text
        AND "paidAt" IS NOT NULL
        AND "paidAt" >= ${from}
        AND "paidAt" < ${toEx}
      GROUP BY 1
      ORDER BY 1 ASC
    `);

    return {
      points: rows.map((r) => ({
        date: r.date,
        revenueJpy: Number(r.revenueJpy ?? 0n),
      })),
    };
  }

  async getMyPostRanking(
    userId: string,
    params: { from?: string; to?: string; limit?: number },
  ) {
    const from =
      parseYmd(params.from) ?? new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const toEx =
      endExclusive(params.to) ?? new Date(Date.now() + 1 * 24 * 3600 * 1000);
    const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);

    const rows = await this.prisma.$queryRaw<
      Array<{ postId: string; title: string; revenueJpy: bigint; buyers: bigint }>
    >(Prisma.sql`
      SELECT
        p."id" AS "postId",
        COALESCE(p."title", '（無題）') AS "title",
        SUM(COALESCE(pay."creatorAmountJpy", pay."amountJpy"))::bigint AS "revenueJpy",
        COUNT(DISTINCT pay."userId")::bigint AS "buyers"
      FROM "Payment" pay
      JOIN "Post" p ON p."id" = pay."postId"
      WHERE pay."creatorId" = ${userId}
        AND pay."paymentStatus"::text = ${PaymentStatus.paid}::text
        AND pay."paidAt" IS NOT NULL
        AND pay."paidAt" >= ${from}
        AND pay."paidAt" < ${toEx}
        AND pay."postId" IS NOT NULL
      GROUP BY p."id", p."title"
      ORDER BY "revenueJpy" DESC
      LIMIT ${Prisma.raw(String(limit))}
    `);

    return {
      items: rows.map((r) => ({
        postId: r.postId,
        title: r.title,
        revenueJpy: Number(r.revenueJpy ?? 0n),
        buyers: Number(r.buyers ?? 0n),
      })),
    };
  }

  async getMySubscriberTrend(
    userId: string,
    params: { granularity: 'day' | 'month'; from?: string; to?: string },
  ) {
    const g = params.granularity ?? 'day';
    const from =
      parseYmd(params.from) ?? new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const toEx =
      endExclusive(params.to) ?? new Date(Date.now() + 1 * 24 * 3600 * 1000);

    const truncNew =
      g === 'month'
        ? Prisma.sql`date_trunc('month', "createdAt")`
        : Prisma.sql`date_trunc('day', "createdAt")`;
    const fmtNew =
      g === 'month'
        ? Prisma.sql`to_char(${truncNew}, 'YYYY-MM')`
        : Prisma.sql`to_char(${truncNew}, 'YYYY-MM-DD')`;

    const truncCan =
      g === 'month'
        ? Prisma.sql`date_trunc('month', "updatedAt")`
        : Prisma.sql`date_trunc('day', "updatedAt")`;
    const fmtCan =
      g === 'month'
        ? Prisma.sql`to_char(${truncCan}, 'YYYY-MM')`
        : Prisma.sql`to_char(${truncCan}, 'YYYY-MM-DD')`;

    const newRows = await this.prisma.$queryRaw<
      Array<{ date: string; cnt: bigint }>
    >(
      Prisma.sql`
        SELECT
          ${fmtNew} AS "date",
          COUNT(*)::bigint AS "cnt"
        FROM "Subscription"
        WHERE "creatorId" = ${userId}
          AND "createdAt" >= ${from}
          AND "createdAt" < ${toEx}
        GROUP BY 1
        ORDER BY 1 ASC
      `,
    );

    const cancelRows = await this.prisma.$queryRaw<
      Array<{ date: string; cnt: bigint }>
    >(
      Prisma.sql`
        SELECT
          ${fmtCan} AS "date",
          COUNT(*)::bigint AS "cnt"
        FROM "Subscription"
        WHERE "creatorId" = ${userId}
          AND "status"::text = ${SubStatus.canceled}::text
          AND "updatedAt" >= ${from}
          AND "updatedAt" < ${toEx}
        GROUP BY 1
        ORDER BY 1 ASC
      `,
    );

    const mapNew = new Map(newRows.map((r) => [r.date, Number(r.cnt ?? 0n)]));
    const mapCan = new Map(cancelRows.map((r) => [r.date, Number(r.cnt ?? 0n)]));

    const keys = Array.from(new Set([...mapNew.keys(), ...mapCan.keys()])).sort();

    return {
      points: keys.map((date) => {
        const newSubs = mapNew.get(date) ?? 0;
        const canceledSubs = mapCan.get(date) ?? 0;
        return { date, newSubs, canceledSubs, net: newSubs - canceledSubs };
      }),
      note: '解約は Subscription.updatedAt を解約日として集計（canceledAt未実装のため暫定）',
    };
  }
}
