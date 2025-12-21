// api/src/apps/shops/shop-self.controller.ts
import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  CreatorApprovalStatus,
  PaymentStatus,
  ShopMemberRole,
  SubStatus,
} from '@prisma/client';
import { ShopAuthService } from './shop-auth.service';

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

type SalesSummaryRes = {
  range: 'today' | 'month' | 'all';
  gross: number;
  paidCount: number;
};

type DashboardSummaryRes = {
  todayGross: number;
  monthGross: number;
  activeSubscribers: number;
  pendingCreatorApplications: number;
};

@UseGuards(JwtAuthGuard)
@Controller()
export class ShopSelfController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shopAuth: ShopAuthService,
  ) {}

  // =========================================================
  // ✅ 正規ルート（/shop 配下）
  // =========================================================

  /**
   * GET /shop/creator-applications?status=pending|approved|rejected...
   * - 自分の所属shopの申請一覧（カーソル対応）
   */
  @Get('shop/creator-applications')
  async listCreatorApplications(
    @Req() req: Request,
    @Query('status') status?: string,
    @Query('take') takeStr?: string,
    @Query('cursor') cursor?: string,
  ) {
    const { shopId } = await this.shopAuth.getMyShopMemberOrThrow(req);

    const take = Math.min(Math.max(Number(takeStr ?? 50), 1), 200);

    // 未指定なら pending
    const st =
      (status as CreatorApprovalStatus | undefined) ??
      CreatorApprovalStatus.pending;

    const items = await this.prisma.creatorApplication.findMany({
      where: { shopId, status: st },
      orderBy: { createdAt: 'desc' },
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        creator: {
          include: {
            user: { select: { id: true, email: true } },
          },
        },
        shop: { select: { id: true, name: true } },
      },
    });

    const nextCursor = items.length === take ? items[items.length - 1].id : null;
    return { items, nextCursor };
  }

  /**
   * GET /shop/sales/summary?range=today|month|all
   * - Payment を creator.shopId で絞って合計
   */
  @Get('shop/sales/summary')
  async salesSummary(
    @Req() req: Request,
    @Query('range') range?: 'today' | 'month' | 'all',
  ): Promise<SalesSummaryRes> {
    const { shopId } = await this.shopAuth.getMyShopMemberOrThrow(req);

    const r = range ?? 'month';
    if (!['today', 'month', 'all'].includes(r)) {
      throw new BadRequestException('range は today|month|all のいずれかです');
    }

    const where: any = {
      paymentStatus: PaymentStatus.paid,
      creator: { shopId },
    };

    if (r === 'today') where.createdAt = { gte: startOfTodayLocal() };
    if (r === 'month') where.createdAt = { gte: startOfMonthLocal() };

    const [agg, paidCount] = await Promise.all([
      this.prisma.payment.aggregate({
        where,
        _sum: { amountJpy: true },
      }),
      this.prisma.payment.count({ where }),
    ]);

    return {
      range: r,
      gross: Number(agg?._sum?.amountJpy ?? 0),
      paidCount,
    };
  }

  /**
   * GET /shop/creators
   * - 自分の所属shopの approved creator 一覧
   * - owner/admin のみ
   */
  @Get('shop/creators')
  async listCreators(@Req() req: Request) {
    const { shopId } = await this.shopAuth.getMyShopMemberOrThrow(req, [
      'owner',
      'admin',
    ]);

    const creators = await this.prisma.creator.findMany({
      where: { shopId, approvalStatus: 'approved' },
      orderBy: { createdAt: 'desc' },
      select: {
        userId: true,
        publicName: true,
        isListed: true,
        stripeKycStatus: true,
        stripeChargesEnabled: true,
        stripePayoutsEnabled: true,
        createdAt: true,
        user: {
          select: {
            email: true,
            profile: { select: { displayName: true, avatarUrl: true } },
          },
        },
      },
    });

    return creators.map((c) => ({
      userId: c.userId,
      publicName: c.publicName,
      displayName: c.user.profile?.displayName ?? null,
      avatarUrl: c.user.profile?.avatarUrl ?? null,
      email: c.user.email,
      isListed: c.isListed,
      kycStatus: c.stripeKycStatus,
      chargesEnabled: c.stripeChargesEnabled,
      payoutsEnabled: c.stripePayoutsEnabled,
      joinedAt: c.createdAt,
    }));
  }

  /**
   * ✅ dashboard を ShopSelf に吸収
   * GET /shop/dashboard/summary
   */
  @Get('shop/dashboard/summary')
  async dashboardSummary(@Req() req: Request): Promise<DashboardSummaryRes> {
    const { shopId } = await this.shopAuth.getMyShopMemberOrThrow(req);

    const todayFrom = startOfTodayLocal();
    const monthFrom = startOfMonthLocal();

    const [todayAgg, monthAgg, subsDistinct, pendingApps] = await Promise.all([
      this.prisma.payment.aggregate({
        where: {
          paymentStatus: PaymentStatus.paid,
          createdAt: { gte: todayFrom },
          creator: { shopId },
        },
        _sum: { amountJpy: true },
      }),

      this.prisma.payment.aggregate({
        where: {
          paymentStatus: PaymentStatus.paid,
          createdAt: { gte: monthFrom },
          creator: { shopId },
        },
        _sum: { amountJpy: true },
      }),

      this.prisma.subscription.findMany({
        where: {
          status: { in: [SubStatus.active, SubStatus.trialing] },
          creator: { shopId },
        },
        distinct: ['userId'],
        select: { userId: true },
      }),

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

  @Get("shop/me")
  async me(@Req() req: Request) {
    const me = await this.shopAuth.getMyShopMemberOrThrow(req);
    return { shopId: me.shopId, role: me.role }; // role: owner|admin|staff
  }

  // =========================================================
  // ✅ 互換ルート（旧 /shops/:shopId/... を残す）
  // =========================================================

  /**
   * 旧: GET /shops/:shopId/creators
   * - フロント互換用（中身は /shop/creators と同じ）
   */
  @Get('shops/:shopId/creators')
  async listCreatorsCompat(
    @Req() req: Request,
    @Param('shopId') shopId: string,
  ) {
    await this.shopAuth.assertMyShopIdMatchesOrThrow(req, shopId, [
      'owner',
      'admin',
    ]);

    const creators = await this.prisma.creator.findMany({
      where: { shopId, approvalStatus: 'approved' },
      orderBy: { createdAt: 'desc' },
      select: {
        userId: true,
        publicName: true,
        isListed: true,
        stripeKycStatus: true,
        stripeChargesEnabled: true,
        stripePayoutsEnabled: true,
        createdAt: true,
        user: {
          select: {
            email: true,
            profile: { select: { displayName: true, avatarUrl: true } },
          },
        },
      },
    });

    return creators.map((c) => ({
      userId: c.userId,
      publicName: c.publicName,
      displayName: c.user.profile?.displayName ?? null,
      avatarUrl: c.user.profile?.avatarUrl ?? null,
      email: c.user.email,
      isListed: c.isListed,
      kycStatus: c.stripeKycStatus,
      chargesEnabled: c.stripeChargesEnabled,
      payoutsEnabled: c.stripePayoutsEnabled,
      joinedAt: c.createdAt,
    }));
  }

  /**
   * 旧: GET /shops/:shopId/creator-applications?status=...
   * - フロント互換用（ページング無しの簡易版として残す）
   */
  @Get('shops/:shopId/creator-applications')
  async listCreatorApplicationsCompat(
    @Req() req: Request,
    @Param('shopId') shopId: string,
    @Query('status') status?: CreatorApprovalStatus,
  ) {
    await this.shopAuth.assertMyShopIdMatchesOrThrow(req, shopId, [
      'owner',
      'admin',
    ]);

    const applications = await this.prisma.creatorApplication.findMany({
      where: { shopId, ...(status && { status }) },
      include: {
        creator: {
          select: {
            userId: true,
            publicName: true,
            user: {
              select: {
                email: true,
                profile: { select: { displayName: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return applications.map((a) => ({
      id: a.id,
      status: a.status,
      publicName: a.publicName,
      createdAt: a.createdAt,
      creator: {
        userId: a.creator.userId,
        displayName:
          a.creator.user.profile?.displayName ?? a.creator.publicName,
        email: a.creator.user.email,
      },
    }));
  }
}
