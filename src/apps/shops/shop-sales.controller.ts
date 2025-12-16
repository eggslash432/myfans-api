// api/src/apps/shops/shop-sales.controller.ts
import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { Request } from 'express';

type Range = 'today' | 'month' | 'all';

@Controller('shops')
export class ShopSalesController {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  @Get(':shopId/sales/summary')
  async summary(
    @Req() req: Request,
    @Param('shopId') shopId: string,
    @Query('range') range: Range = 'month',
  ) {
    const userId = String((req as any).user?.id ?? '');
    if (!userId) throw new BadRequestException('ログイン情報が取得できません');

    // 権限チェック
    const member = await this.prisma.shopMember.findUnique({
      where: {
        shopId_userId: {
          shopId,
          userId,
        },
      },
    });
    if (!member || !['owner', 'admin'].includes(member.role)) {
      throw new ForbiddenException('Shop 管理権限がありません');
    }

    // 期間条件
    let from: Date | undefined;
    const now = new Date();

    if (range === 'today') {
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (range === 'month') {
      from = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    // 対象 Payment 取得
    const payments = await this.prisma.payment.findMany({
      where: {
        paymentStatus: 'paid',
        ...(from && { createdAt: { gte: from } }),
        creator: {
          shopId,
        },
      },
      select: {
        amountJpy: true,
        shopPercent: true,
      },
    });

    // 集計
    let totalAmount = 0;
    let shopAmount = 0;

    for (const p of payments) {
      totalAmount += p.amountJpy;
      if (p.shopPercent && p.shopPercent > 0) {
        shopAmount += Math.floor((p.amountJpy * p.shopPercent) / 100);
      }
    }

    return {
      range,
      totalAmount,
      shopAmount,
      paymentCount: payments.length,
    };
  }
}
