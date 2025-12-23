// api/src/apps/shops/shop-sales.controller.ts
import { BadRequestException, Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';

import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TransferKind } from '@prisma/client';
import { ShopAuthService } from './shop-auth.service';
import { SalesSummaryRes } from 'src/shared/types';
import { startOfMonthLocal, startOfTodayLocal } from './shop-utils';

@UseGuards(JwtAuthGuard)
@Controller()
export class ShopSalesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shopAuth: ShopAuthService,
  ) {}

  /**
   * GET /shop/sales/summary?range=today|month|all
   * - Transfer(kind=shop) を shopId で絞って合計（Stripe未連携でも台帳が残る想定）
   */
  @Get('shops/sales/summary')
  async salesSummary(
    @Req() req: Request,
    @Query('range') range?: 'today' | 'month' | 'all',
  ): Promise<SalesSummaryRes> {
    const { shopId } = await this.shopAuth.getMyShopMemberOrThrow(req);

    const r = range ?? 'month';
    if (!['today', 'month', 'all'].includes(r)) {
      throw new BadRequestException('range は today|month|all のいずれかです');
    }

    const whereShopTransfer: any = {
      kind: TransferKind.shop,
      shopId,
    };

    if (r === 'today') whereShopTransfer.createdAt = { gte: startOfTodayLocal() };
    if (r === 'month') whereShopTransfer.createdAt = { gte: startOfMonthLocal() };

    const [shopAgg, transactions, paymentIdsRows] = await Promise.all([
      this.prisma.transfer.aggregate({
        where: whereShopTransfer,
        _sum: { amountJpy: true },
      }),
      this.prisma.transfer.count({ where: whereShopTransfer }),
      this.prisma.transfer.findMany({
        where: whereShopTransfer,
        select: { paymentId: true },
      }),
    ]);

    const gross = Number(shopAgg?._sum?.amountJpy ?? 0);

    // platformFee（同じ paymentId 群の platform 取り分）
    const uniqPaymentIds = Array.from(new Set(paymentIdsRows.map((x) => x.paymentId)));

    let platformFee = 0;
    if (uniqPaymentIds.length > 0) {
      const platformAgg = await this.prisma.transfer.aggregate({
        where: {
          kind: TransferKind.platform,
          paymentId: { in: uniqPaymentIds },
        },
        _sum: { amountJpy: true },
      });
      platformFee = Number(platformAgg?._sum?.amountJpy ?? 0);
    }

    return {
      range: r,
      gross,
      platformFee,
      net: gross,
      transactions,
    };
  }
}
