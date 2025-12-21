// api/src/apps/shops/shop-dashboard.controller.ts
import {
  Controller,
  Get,
  Req,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { UseGuards } from '@nestjs/common';
import type { Request } from 'express';

import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PaymentStatus, SubStatus, CreatorApprovalStatus } from '@prisma/client';

type DashboardSummaryRes = {
  todayGross: number;
  monthGross: number;
  activeSubscribers: number;
  pendingCreatorApplications: number;
};

function startOfTodayLocal(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfMonthLocal(): Date {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

@UseGuards(JwtAuthGuard)
@Controller('shop/dashboard')
export class ShopDashboardController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /shop/dashboard/summary
   * ShopMember -> shopId を特定し、Creator.shopId 経由で集計
   */
  @UseGuards(JwtAuthGuard)
  @Get('summary')
  async summary(@Req() req: Request): Promise<DashboardSummaryRes> {
    const userId = String((req as any).user?.id ?? '');
    if (!userId) throw new UnauthorizedException('ログイン情報が取得できません');

    // 自分が所属する shopId を取得
    const shopMember = await this.prisma.shopMember.findFirst({
      where: { userId },
      select: { shopId: true },
    });

    if (!shopMember?.shopId) {
      throw new ForbiddenException('Shop に所属していません');
    }
    const shopId = shopMember.shopId;

    const todayFrom = startOfTodayLocal();
    const monthFrom = startOfMonthLocal();

    const [todayAgg, monthAgg, subsDistinct, pendingApps] = await Promise.all([
      // 今日売上：Payment -> creator -> shopId で絞る
      this.prisma.payment.aggregate({
        where: {
          paymentStatus: PaymentStatus.paid,
          createdAt: { gte: todayFrom },
          creator: { shopId }, // ✅ shopId は Payment じゃなく Creator にある
        },
        _sum: { amountJpy: true },
      }),

      // 今月売上
      this.prisma.payment.aggregate({
        where: {
          paymentStatus: PaymentStatus.paid,
          createdAt: { gte: monthFrom },
          creator: { shopId },
        },
        _sum: { amountJpy: true },
      }),

      // アクティブ購読者（active / trialing のユニーク userId）
      this.prisma.subscription.findMany({
        where: {
          status: { in: [SubStatus.active, SubStatus.trialing] },
          creator: { shopId },
        },
        distinct: ['userId'],
        select: { userId: true },
      }),

      // 承認待ち creatorApplication 件数（status が pending）
      this.prisma.creatorApplication.count({
        where: {
          shopId,
          status: CreatorApprovalStatus.pending, // ✅ approvalStatus ではなく status
        },
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
