// src/apps/creators/creator-payouts.controller.ts

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CreatorHelper } from '../helpers/creator.helper';
import { PayoutStatus } from '@prisma/client';

type UserJwt = {
  sub: string;
  role: 'fan' | 'creator' | 'admin';
  email?: string;
};

@Controller('creators/me/payouts')
@UseGuards(JwtAuthGuard)
export class CreatorPayoutsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly creatorHelper: CreatorHelper,
  ) {}

  /**
   * ① 出金可能残高の取得
   * GET /api/creators/me/payouts/balance
   *
   * フロント期待: { balanceJpy: number }
   */
  @Get('balance')
  async getBalance(@Req() req: any) {
    const user = req.user as UserJwt | undefined;
    const userId = user?.sub ?? (req.user?.id as string | undefined);
    if (!userId) throw new BadRequestException('Unauthenticated');

    // クリエイターID（＝userId）を取得＆creator 以外は弾く
    const creatorId = await this.creatorHelper.getMyCreatorId(userId);

    // 1) creator の売上（creatorAmountJpy の合計。status=paid のみ）
    const paymentsAgg = await this.prisma.payment.aggregate({
      where: {
        creatorId,
        paymentStatus: 'paid',
      },
      _sum: {
        creatorAmountJpy: true,
      },
    });

    const totalEarnings = paymentsAgg._sum.creatorAmountJpy ?? 0;

    // 2) すでに requested / approved / paid 済みの出金申請合計
    const payoutsAgg = await this.prisma.payout.aggregate({
      where: {
        creatorId,
        payoutStatus: {
          in: ['requested', 'approved', 'paid'] as PayoutStatus[],
        },
      },
      _sum: {
        amountJpy: true,
      },
    });

    const requestedOrPaid = payoutsAgg._sum.amountJpy ?? 0;

    // 3) 残高 = 売上 - 出金申請済み
    const balance = Math.max(totalEarnings - requestedOrPaid, 0);

    return { balanceJpy: balance };
  }

  /**
   * ② 出金履歴一覧
   * GET /api/creators/me/payouts
   *
   * フロント期待: Payout[]（id, amountJpy, payoutStatus, requestedAt, paidAt, note）
   */
  @Get()
  async listPayouts(@Req() req: any) {
    const user = req.user as UserJwt | undefined;
    const userId = user?.sub ?? (req.user?.id as string | undefined);
    if (!userId) throw new BadRequestException('Unauthenticated');

    const creatorId = await this.creatorHelper.getMyCreatorId(userId);

    const items = await this.prisma.payout.findMany({
      where: { creatorId },
      orderBy: { requestedAt: 'desc' },
    });

    // そのまま返せば PayoutsPage.tsx の型と合う
    return items;
  }

  /**
   * ③ 出金申請の作成
   * POST /api/creators/me/payouts/request
   * body: { amountJpy: number, note?: string }
   */
  @Post('request')
  async requestPayout(
    @Req() req: any,
    @Body()
    dto: {
      amountJpy?: number;
      note?: string;
    },
  ) {
    const user = req.user as UserJwt | undefined;
    const userId = user?.sub ?? (req.user?.id as string | undefined);
    if (!userId) throw new BadRequestException('Unauthenticated');

    const creatorId = await this.creatorHelper.getMyCreatorId(userId);

    const amount = Number(dto.amountJpy ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('amountJpy must be a positive number');
    }

    // 現在の残高を再計算（上と同じロジック）
    const paymentsAgg = await this.prisma.payment.aggregate({
      where: {
        creatorId,
        paymentStatus: 'paid',
      },
      _sum: {
        creatorAmountJpy: true,
      },
    });
    const totalEarnings = paymentsAgg._sum.creatorAmountJpy ?? 0;

    const payoutsAgg = await this.prisma.payout.aggregate({
      where: {
        creatorId,
        payoutStatus: {
          in: ['requested', 'approved', 'paid'] as PayoutStatus[],
        },
      },
      _sum: {
        amountJpy: true,
      },
    });
    const requestedOrPaid = payoutsAgg._sum.amountJpy ?? 0;

    const balance = Math.max(totalEarnings - requestedOrPaid, 0);

    if (amount > balance) {
      throw new BadRequestException(
        `出金額が利用可能残高を超えています (利用可能: ${balance}円)`,
      );
    }

    const payout = await this.prisma.payout.create({
      data: {
        creatorId,
        amountJpy: amount,
        payoutStatus: 'requested',
        note: dto.note ?? null,
      },
    });

    return payout;
  }
}
