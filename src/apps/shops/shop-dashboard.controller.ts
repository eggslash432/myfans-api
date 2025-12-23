// api/src/apps/shops/shop-dashboard.controller.ts
import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';

import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreatorApprovalStatus, SubStatus, TransferKind } from '@prisma/client';
import { ShopAuthService } from './shop-auth.service';
import { startOfMonthLocal, startOfTodayLocal } from './shop-utils';

type DashboardSummaryRes = {
  todayGross: number; // ✅ shop取り分（今日）
  monthGross: number; // ✅ shop取り分（今月）
  activeSubscribers: number;
  pendingCreatorApplications: number;
};

@UseGuards(JwtAuthGuard)
@Controller()
export class ShopDashboardController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shopAuth: ShopAuthService,
  ) {}

  /**
   * GET /shop/dashboard/summary
   * - ✅ Transfer(kind=shop) の createdAt 基準で集計（sales/summary と基準統一）
   */
  @Get('shop/dashboard/summary')
  async dashboardSummary(@Req() req: Request): Promise<DashboardSummaryRes> {
    const { shopId } = await this.shopAuth.getMyShopMemberOrThrow(req);

    const todayFrom = startOfTodayLocal();
    const monthFrom = startOfMonthLocal();

    const [todayAgg, monthAgg, subsDistinct, pendingApps] = await Promise.all([
      // ✅ 今日の shop 取り分（Transfer.createdAt 基準）
      this.prisma.transfer.aggregate({
        where: {
          kind: TransferKind.shop,
          shopId,
          createdAt: { gte: todayFrom },
        },
        _sum: { amountJpy: true },
      }),

      // ✅ 今月の shop 取り分（Transfer.createdAt 基準）
      this.prisma.transfer.aggregate({
        where: {
          kind: TransferKind.shop,
          shopId,
          createdAt: { gte: monthFrom },
        },
        _sum: { amountJpy: true },
      }),

      // アクティブ購読者（クリエイターが所属するshopの分）
      this.prisma.subscription.findMany({
        where: {
          status: { in: [SubStatus.active, SubStatus.trialing] },
          creator: { shopId },
        },
        distinct: ['userId'],
        select: { userId: true },
      }),

      // 承認待ち申請
      this.prisma.creatorApplication.count({
        where: { shopId, status: CreatorApprovalStatus.pending },
      }),
    ]);

    return {
      todayGross: Number(todayAgg?._sum?.amountJpy ?? 0),
      monthGross: Number(monthAgg?._sum?.amountJpy ?? 0),
      activeSubscribers: subsDistinct.length,
      pendingCreatorApplications: pendingApps,
    };
  }
}
