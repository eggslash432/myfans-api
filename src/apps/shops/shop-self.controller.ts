// api/src/apps/shops/shop-self.controller.ts
import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Req,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { UseGuards } from '@nestjs/common';
import type { Request } from 'express';

import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreatorApprovalStatus, PaymentStatus } from '@prisma/client';

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

@UseGuards(JwtAuthGuard)
@Controller('shop')
export class ShopSelfController {
  constructor(private readonly prisma: PrismaService) {}

  private async getMyShopIdOrThrow(req: Request): Promise<string> {
    const userId = String((req as any).user?.id ?? '');
    if (!userId) throw new UnauthorizedException('ログイン情報が取得できません');

    const shopMember = await this.prisma.shopMember.findFirst({
      where: { userId },
      select: { shopId: true },
    });

    if (!shopMember?.shopId) throw new ForbiddenException('Shop に所属していません');
    return shopMember.shopId;
  }

  /**
   * GET /shop/creator-applications?status=pending|approved|rejected...
   * - 自分の所属shopの申請一覧
   */
  @UseGuards(JwtAuthGuard)
  @Get('creator-applications')
  async listCreatorApplications(
    @Req() req: Request,
    @Query('status') status?: string,
    @Query('take') takeStr?: string,
    @Query('cursor') cursor?: string,
  ) {
    const shopId = await this.getMyShopIdOrThrow(req);

    const take = Math.min(Math.max(Number(takeStr ?? 50), 1), 200);

    // 未指定なら pending
    const st =
      (status as CreatorApprovalStatus | undefined) ??
      CreatorApprovalStatus.pending;

    const items = await this.prisma.creatorApplication.findMany({
      where: {
        shopId,
        status: st, // ✅ status
      },
      orderBy: { createdAt: 'desc' },
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        creator: {
          include: {
            user: { select: { id: true, email: true } }, // 必要なら profile も
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
  @UseGuards(JwtAuthGuard)
  @Get('sales/summary')
  async salesSummary(
    @Req() req: Request,
    @Query('range') range?: 'today' | 'month' | 'all',
  ): Promise<SalesSummaryRes> {
    const shopId = await this.getMyShopIdOrThrow(req);

    const r = range ?? 'month';
    if (!['today', 'month', 'all'].includes(r)) {
      throw new BadRequestException('range は today|month|all のいずれかです');
    }

    const where: any = {
      paymentStatus: PaymentStatus.paid,
      creator: { shopId }, // ✅ Payment から Creator 経由で shopId
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
}
