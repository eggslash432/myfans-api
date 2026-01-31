// api/src/apps/shops/shop-me.controller.ts
import { Controller, Get, Req, UseGuards, ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ShopAuthService } from './shop-auth.service';
import { PrismaService } from '../prisma/prisma.service';

@UseGuards(JwtAuthGuard)
@Controller()
export class ShopMeController {
  constructor(
    private readonly shopAuth: ShopAuthService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * ✅ 所属確認用（BottomNav等で使用）
   * - 営業許可が未承認でも 200 を返す
   */
  @Get('shops/me/context')
  async context(@Req() req: Request) {
    const me = await this.shopAuth.getMyShopMemberOrThrow(req);

    const shop = await this.prisma.shop.findUnique({
      where: { id: me.shopId },
      select: { businessLicenseStatus: true },
    });

    return {
      shopId: me.shopId,
      role: me.role,
      businessLicenseStatus: shop?.businessLicenseStatus ?? 'pending',
    };
  }

  /**
   * ✅ /shops の ProtectedRoute 判定用
   * - 営業許可が approved 以外なら 403 + code を返す
   */
  @Get('shops/me')
  async me(@Req() req: Request) {
    const me = await this.shopAuth.getMyShopMemberOrThrow(req);

    const shop = await this.prisma.shop.findUnique({
      where: { id: me.shopId },
      select: { businessLicenseStatus: true },
    });

    if (!shop) {
      throw new ForbiddenException({
        code: 'SHOP_NOT_FOUND',
        message: 'shop not found',
      });
    }

    if (shop.businessLicenseStatus !== 'approved') {
      throw new ForbiddenException({
        code: 'BUSINESS_LICENSE_NOT_APPROVED',
        message: 'business license not approved',
      });
    }

    return { shopId: me.shopId, role: me.role };
  }
}
