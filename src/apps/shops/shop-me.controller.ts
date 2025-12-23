// api/src/apps/shops/shop-me.controller.ts
import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ShopAuthService } from './shop-auth.service';

@UseGuards(JwtAuthGuard)
@Controller()
export class ShopMeController {
  constructor(private readonly shopAuth: ShopAuthService) {}

  @Get('shop/me')
  async me(@Req() req: Request) {
    const me = await this.shopAuth.getMyShopMemberOrThrow(req);
    return { shopId: me.shopId, role: me.role };
  }
}
