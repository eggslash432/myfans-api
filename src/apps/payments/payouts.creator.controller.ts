// src/apps/payments/payouts.creator.controller.ts
import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreatorOnlyGuard } from '../access-control/creator-only.guard';
import { PrismaService } from '../prisma/prisma.service';
import { PayoutsRequestsService } from './payouts/services/payouts-requests.service';
import { PayoutsBalanceService } from './payouts/services/payouts-balance.service';


@Controller('creators/me/payouts')
@UseGuards(JwtAuthGuard, CreatorOnlyGuard)
export class CreatorPayoutsController {
  constructor(
    private readonly payoutsRequestsService: PayoutsRequestsService,
    private readonly payoutsBalanceService: PayoutsBalanceService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * 共通：KYCチェック
   *
   * ✅ フェーズ1の前提：
   * - creator の識別子は「Creator.id」ではなく「creator.userId (= User.id)」
   */
  private async assertCreatorCanPayout(creatorUserId: string) {
    const creator = await this.prisma.creator.findUnique({
      where: { userId: creatorUserId },
      select: {
        stripeKycStatus: true,
        stripePayoutsEnabled: true,
      },
    });

    if (!creator || creator.stripeKycStatus !== 'approved') {
      throw new ForbiddenException('KYC未完了のため利用できません。');
    }

    if (!creator.stripePayoutsEnabled) {
      throw new ForbiddenException(
        'Stripe側の審査が未完了のため利用できません。',
      );
    }
  }

  /**
   * 残高取得
   */
  @Get('balance')
  async getBalance(@Req() req: any) {
    const creatorUserId = req.user.id as string;

    await this.assertCreatorCanPayout(creatorUserId);

    const balance = await this.payoutsBalanceService.getCreatorBalanceJpy(
      creatorUserId,
    );
    return { balanceJpy: balance };
  }

  /**
   * 自分の出金履歴
   */
  @Get()
  async listMine(@Req() req: any) {
    const creatorUserId = req.user.id as string;

    await this.assertCreatorCanPayout(creatorUserId);

    return this.payoutsRequestsService.listCreatorPayouts(creatorUserId);
  }

  /**
   * 出金申請
   */
  @Post('request')
  async request(
    @Req() req: any,
    @Body() body: { amountJpy: number; note?: string },
  ) {
    const creatorUserId = req.user.id as string;

    await this.assertCreatorCanPayout(creatorUserId);

    const amount = Number(body.amountJpy);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('amountJpy must be a positive number');
    }

    return this.payoutsRequestsService.requestCreatorPayout(
      creatorUserId,
      amount,
      body.note,
    );
  }
}
