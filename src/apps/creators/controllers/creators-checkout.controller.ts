// api/src/apps/creators/controllers/creators-checkout.controller.ts

import { Controller, Param, Post } from '@nestjs/common';
import { CreatorsService } from '../creators.service';

@Controller('creators')
export class CreatorsCheckoutController {
  constructor(private readonly creatorsService: CreatorsService) {}

  @Post(':creatorId/plans/:planId/checkout')
  async createCheckout(
    @Param('creatorId') creatorId: string,
    @Param('planId') planId: string,
  ) {
    return { url: await this.creatorsService.createSubscriptionCheckout(creatorId, planId) };
  }
}
