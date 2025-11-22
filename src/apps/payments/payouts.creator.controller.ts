// src/apps/payments/payouts.creator.controller.ts
import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreatorOnlyGuard } from '../access-control/creator-only.guard';
import { PayoutsService } from './payouts.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller('creators/me/payouts')
@UseGuards(JwtAuthGuard, CreatorOnlyGuard)
export class CreatorPayoutsController {
  constructor(
    private readonly payouts: PayoutsService,
    private readonly prisma: PrismaService, // ★ 追加
  ) {}

  // 残高取得
  @Get('balance')
  async getBalance(@Req() req: any) {
    const creatorId = req.user.sub as string;
    
    // ★ KYC チェック（出金のとき重要）
    const creator = await this.prisma.creator.findUnique({
      where: { userId: creatorId },
      select: {
        stripeKycStatus: true,
        stripePayoutsEnabled: true,
      },
    });

    if (!creator || creator.stripeKycStatus !== 'verified') {
      throw new ForbiddenException('KYC未完了のため残高を取得できません。');
    }

    if (!creator.stripePayoutsEnabled) {
      throw new ForbiddenException(
        'Stripe側の審査が未完了のため、出金機能が利用できません。',
      );
    }

    const balance = await this.payouts.getCreatorBalanceJpy(creatorId);
    return { balanceJpy: balance };
  }

  // 自分の Payout 一覧
  @Get()
  async listMine(@Req() req: any) {
    const creatorId = req.user.sub as string;

    // ★ KYC チェック（一覧も禁止する）
    const creator = await this.prisma.creator.findUnique({
      where: { userId: creatorId },
      select: {
        stripeKycStatus: true,
        stripePayoutsEnabled: true,
      },
    });

    if (!creator || creator.stripeKycStatus !== 'verified') {
      throw new ForbiddenException('KYC未完了のため出金履歴を表示できません。');
    }

    if (!creator.stripePayoutsEnabled) {
      throw new ForbiddenException(
        'Stripe側の審査が未完了のため、出金履歴を表示できません。',
      );
    }

    const all = await this.payouts.adminListPayouts(undefined);
    return all.filter((p) => p.creatorId === creatorId);
  }

  // 出金リクエスト
  @Post('request')
  async request(@Req() req: any, @Body() body: { amountJpy: number }) {
    const creatorId = req.user.sub as string;
    const amount = Number(body.amountJpy);

    // ★ KYC チェック（ここが最重要）
    const creator = await this.prisma.creator.findUnique({
      where: { userId: creatorId },
      select: {
        stripeKycStatus: true,
        stripePayoutsEnabled: true,
      },
    });

    if (!creator || creator.stripeKycStatus !== 'verified') {
      throw new ForbiddenException('KYC未完了のため出金リクエストはできません。');
    }

    if (!creator.stripePayoutsEnabled) {
      throw new ForbiddenException(
        'Stripe側の審査が未完了のため、出金リクエストはできません。',
      );
    }

    return this.payouts.requestPayout(creatorId, amount);
  }
}
