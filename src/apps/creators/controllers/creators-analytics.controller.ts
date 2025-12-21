// api/src/apps/creators/controllers/creators-analytics.controller.ts

import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { CreatorsService } from '../creators.service';
import { CreatorsControllerHelpers } from './creators.controller-helpers';

@Controller('creators/analytics')
@UseGuards(JwtAuthGuard)
export class CreatorsAnalyticsController {
  constructor(
    private readonly creatorsService: CreatorsService,
    private readonly helpers: CreatorsControllerHelpers,
  ) {}

  @Get('me')
  async analyticsMe(@Req() req: any) {
    const userId = this.helpers.getUserIdOrThrow(req);
    await this.helpers.requireCreatorApproved(userId);
    return this.creatorsService.getMySimpleAnalytics(userId);
  }

  @Get('me/revenue-trend')
  async revenueTrend(
    @Req() req: any,
    @Query('granularity') granularity: 'day' | 'month' = 'day',
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const userId = this.helpers.getUserIdOrThrow(req);
    await this.helpers.requireCreatorApproved(userId);
    return this.creatorsService.getMyRevenueTrend(userId, { granularity, from, to });
  }

  @Get('me/post-ranking')
  async postRanking(
    @Req() req: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit = '20',
  ) {
    const userId = this.helpers.getUserIdOrThrow(req);
    await this.helpers.requireCreatorApproved(userId);

    return this.creatorsService.getMyPostRanking(userId, {
      from,
      to,
      limit: this.helpers.parseLimit(limit, 20, 1, 100),
    });
  }

  @Get('me/subscriber-trend')
  async subscriberTrend(
    @Req() req: any,
    @Query('granularity') granularity: 'day' | 'month' = 'day',
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const userId = this.helpers.getUserIdOrThrow(req);
    await this.helpers.requireCreatorApproved(userId);
    return this.creatorsService.getMySubscriberTrend(userId, { granularity, from, to });
  }
}
