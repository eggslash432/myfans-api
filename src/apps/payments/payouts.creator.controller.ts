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
import { PayoutsAdminService } from './payouts-admin.service';
import { PayoutsBalanceService } from './payouts-balance.service';
import { PayoutsRequestsService } from './payouts-requests.service';

@Controller('creators/me/payouts')
@UseGuards(JwtAuthGuard, CreatorOnlyGuard)
export class CreatorPayoutsController {
  constructor(
    private readonly payoutsRequestsService: PayoutsRequestsService,
    private readonly payoutsBalanceService :PayoutsBalanceService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * 共通：KYCチェック
   */
  private async assertCreatorCanPayout(creatorId: string) {
    const creator = await this.prisma.creator.findUnique({
      where: { userId: creatorId },
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
    const creatorId = req.user.id as string;
    await this.assertCreatorCanPayout(creatorId);

    const balance = await this.payoutsBalanceService.getCreatorBalanceJpy(creatorId);
    return { balanceJpy: balance };
  }

  /**
   * 自分の出金履歴
   */
  @Get()
  async listMine(@Req() req: any) {
    const creatorId = req.user.id as string;
    await this.assertCreatorCanPayout(creatorId);

    return this.payoutsRequestsService.listCreatorPayouts(creatorId);
  }

  /**
   * 出金申請
   */
  @Post('request')
  async request(
    @Req() req: any,
    @Body() body: { amountJpy: number; note?: string },
  ) {
    const creatorId = req.user.id as string;
    await this.assertCreatorCanPayout(creatorId);

    const amount = Number(body.amountJpy);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('amountJpy must be a positive number');
    }

    return this.payoutsRequestsService.requestCreatorPayout(
      creatorId,
      amount,
      body.note,
    );
  }
}
