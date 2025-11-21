// src/apps/payments/payouts.creator.controller.ts
import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreatorOnlyGuard } from '../access-control/creator-only.guard';
import { PayoutsService } from './payouts.service';

@Controller('creators/me/payouts')
@UseGuards(JwtAuthGuard, CreatorOnlyGuard)
export class CreatorPayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  // 残高取得
  @Get('balance')
  async getBalance(@Req() req: any) {
    const creatorId = req.user.sub as string;
    const balance = await this.payouts.getCreatorBalanceJpy(creatorId);
    return { balanceJpy: balance };
  }

  // 自分の Payout 一覧
  @Get()
  async listMine(@Req() req: any) {
    const creatorId = req.user.sub as string;
    // 状態フィルタなど必要なら Body/Query で拡張
    const all = await this.payouts.adminListPayouts(undefined);
    return all.filter((p) => p.creatorId === creatorId);
  }

  // 出金リクエスト
  @Post('request')
  async request(@Req() req: any, @Body() body: { amountJpy: number }) {
    const creatorId = req.user.sub as string;
    const amount = Number(body.amountJpy);
    return this.payouts.requestPayout(creatorId, amount);
  }
}
