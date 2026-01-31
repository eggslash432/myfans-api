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
import { Prisma } from '@prisma/client';
import { ShopAuthService } from './shop-auth.service';
import { SalesSummaryRes } from 'src/shared/types';
import { startOfMonthLocal, startOfTodayLocal } from './shop-utils';
import { ShopLicenseApprovedGuard } from '../access-control/shop-license-approved.guard';

@UseGuards(JwtAuthGuard, ShopLicenseApprovedGuard)
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

    // ✅ 売上は paidAt 基準
    const paidAtFilter =
      r === 'today'
        ? { gte: startOfTodayLocal() }
        : r === 'month'
          ? { gte: startOfMonthLocal() }
          : undefined;

    const where: Prisma.PaymentWhereInput = {
      shopId,
      paymentStatus: 'paid',
      ...(paidAtFilter ? { paidAt: paidAtFilter } : {}),
    };

    const [agg, transactions] = await Promise.all([
      this.prisma.payment.aggregate({
        where,
        _sum: {
          amountJpy: true,      // gross
          shopAmountJpy: true,  // shop取り分（Stripe差引前）
          stripeFeeJpy: true,   // Stripe実費（後確定）
        },
      }),
      this.prisma.payment.count({ where }),
    ]);

    const gross = Number(agg._sum.amountJpy ?? 0);

    const shopSum = Number(agg._sum.shopAmountJpy ?? 0);
    const stripeFeeSum = Number(agg._sum.stripeFeeJpy ?? 0);

    // ✅ 案B：実入金（入金対象）
    const net = Math.max(shopSum - stripeFeeSum, 0);

    // ✅ 表示上の「控除額（手数料）」＝ 総額 − 実入金
    const platformFee = Math.max(0, gross - net);

    return {
      range: r,
      gross,
      platformFee,
      net,
      transactions,
    };
  }
}
