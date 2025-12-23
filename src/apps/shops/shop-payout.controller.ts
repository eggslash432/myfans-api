// api/src/apps/shops/shop-payout.controller.ts
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
import { ShopOnlyGuard } from '../access-control/shop-only.guard';
import { CreateShopPayoutDto } from './dto/shop-payout.dto';
import { PayoutsRequestsService } from '../payments/payouts-requests.service';
import { PayoutsBalanceService } from '../payments/payouts-balance.service';

@Controller('shops/me/payouts')
@UseGuards(JwtAuthGuard, ShopOnlyGuard)
export class ShopPayoutController {
  constructor(
    private readonly payoutsRequestService: PayoutsRequestsService,
    private readonly payoutsBalanceService: PayoutsBalanceService,
   ) {}

  /**
   * 出金可能残高
   * GET /shops/me/payouts/balance
   */
  @Get('balance')
  async balance(@Req() req: any) {
    const shopId = req.user.shopId as string;
    if (!shopId) {
      throw new BadRequestException('shop context not found');
    }

    const balance = await this.payoutsBalanceService.getShopBalanceJpy(shopId);
    return { balanceJpy: balance };
  }

  /**
   * 自分の出金履歴
   * GET /shops/me/payouts
   */
  @Get()
  async listMine(@Req() req: any) {
    const shopId = req.user.shopId as string;
    if (!shopId) {
      throw new BadRequestException('shop context not found');
    }

    return this.payoutsRequestService.listShopPayouts(shopId);
  }

  /**
   * 出金申請
   * POST /shops/me/payouts/request
   */
  @Post('request')
  async request(
    @Req() req: any,
    @Body() dto: CreateShopPayoutDto,
  ) {
    const shopId = req.user.shopId as string;
    if (!shopId) {
      throw new BadRequestException('shop context not found');
    }

    const payout = await this.payoutsRequestService.requestShopPayout(
      shopId,
      dto.amountJpy,
      dto.note,
    );

    return {
      id: payout.payout.id,
      status: payout.payout.payoutStatus,
      availableAfter: payout.availableAfter,
    };
  }
}

