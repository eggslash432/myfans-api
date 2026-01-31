// api/src/apps/shops/shop-creators.controller.ts
import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';

import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ShopAuthService } from './shop-auth.service';
import { ShopLicenseApprovedGuard } from '../access-control/shop-license-approved.guard';

@UseGuards(JwtAuthGuard, ShopLicenseApprovedGuard)
@Controller()
export class ShopCreatorsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shopAuth: ShopAuthService,
  ) {}

  /**
   * GET /shop/creators
   * - 自分の所属shopの approved creator 一覧
   * - owner/admin のみ
   */
  @Get('shops/creators')
  async listCreators(@Req() req: Request) {
    const { shopId } = await this.shopAuth.getMyShopMemberOrThrow(req, [
      'owner',
      'admin',
    ]);

    const creators = await this.prisma.creator.findMany({
      where: { shopId, approvalStatus: 'approved' },
      orderBy: { createdAt: 'desc' },
      select: {
        userId: true,
        publicName: true,
        isListed: true,
        stripeKycStatus: true,
        stripeChargesEnabled: true,
        stripePayoutsEnabled: true,
        createdAt: true,
        user: {
          select: {
            email: true,
            profile: { select: { displayName: true, avatarUrl: true } },
          },
        },
      },
    });

    return creators.map((c) => ({
      userId: c.userId,
      publicName: c.publicName,
      displayName: c.user.profile?.displayName ?? null,
      avatarUrl: c.user.profile?.avatarUrl ?? null,
      email: c.user.email,
      isListed: c.isListed,
      kycStatus: c.stripeKycStatus,
      chargesEnabled: c.stripeChargesEnabled,
      payoutsEnabled: c.stripePayoutsEnabled,
      joinedAt: c.createdAt,
    }));
  }

  /**
   * 旧: GET /shops/:shopId/creators
   * - フロント互換用（中身は /shop/creators と同じ）
   */
  @Get('shops/:shopId/creators')
  async listCreatorsCompat(@Req() req: Request, @Param('shopId') shopId: string) {
    await this.shopAuth.assertMyShopIdMatchesOrThrow(req, shopId, [
      'owner',
      'admin',
    ]);

    const creators = await this.prisma.creator.findMany({
      where: { shopId, approvalStatus: 'approved' },
      orderBy: { createdAt: 'desc' },
      select: {
        userId: true,
        publicName: true,
        isListed: true,
        stripeKycStatus: true,
        stripeChargesEnabled: true,
        stripePayoutsEnabled: true,
        createdAt: true,
        user: {
          select: {
            email: true,
            profile: { select: { displayName: true, avatarUrl: true } },
          },
        },
      },
    });

    return creators.map((c) => ({
      userId: c.userId,
      publicName: c.publicName,
      displayName: c.user.profile?.displayName ?? null,
      avatarUrl: c.user.profile?.avatarUrl ?? null,
      email: c.user.email,
      isListed: c.isListed,
      kycStatus: c.stripeKycStatus,
      chargesEnabled: c.stripeChargesEnabled,
      payoutsEnabled: c.stripePayoutsEnabled,
      joinedAt: c.createdAt,
    }));
  }
}
