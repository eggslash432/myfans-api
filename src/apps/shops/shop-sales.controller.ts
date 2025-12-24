// api/src/apps/shops/shop-sales.controller.ts
import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TransferKind, Prisma } from '@prisma/client';
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
   * GET /shops/sales/summary?range=today|month|all
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

    // ✅ range条件（createdAt）
    const createdAtFilter =
      r === 'today'
        ? { gte: startOfTodayLocal() }
        : r === 'month'
          ? { gte: startOfMonthLocal() }
          : undefined;

    const whereShopTransfer: Prisma.TransferWhereInput = {
      kind: TransferKind.shop,
      shopId,
      ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
    };

    const [shopAgg, transactions, paymentIdRows] = await Promise.all([
      this.prisma.transfer.aggregate({
        where: whereShopTransfer,
        _sum: { amountJpy: true },
      }),
      this.prisma.transfer.count({ where: whereShopTransfer }),
      // ✅ findMany + distinct でDB側でユニーク化（重さ回避）
      this.prisma.transfer.findMany({
        where: whereShopTransfer,
        distinct: ['paymentId'],
        select: { paymentId: true },
      }),
    ]);

    const gross = Number(shopAgg._sum.amountJpy ?? 0);

    const uniqPaymentIds = paymentIdRows
      .map((x) => x.paymentId)
      .filter((v): v is string => !!v);

    let platformFee = 0;
    if (uniqPaymentIds.length > 0) {
      const platformWhere: Prisma.TransferWhereInput = {
        kind: TransferKind.platform,
        paymentId: { in: uniqPaymentIds },
        // ✅ range整合（ブレ防止）
        ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
      };

      const platformAgg = await this.prisma.transfer.aggregate({
        where: platformWhere,
        _sum: { amountJpy: true },
      });
      platformFee = Number(platformAgg._sum.amountJpy ?? 0);
    }

    return {
      range: r,
      gross,
      platformFee,
      net: gross, // 今は shop取り分=net ならこのまま。将来差引くならここで反映
      transactions,
    };
  }
}
