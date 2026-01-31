// api/src/apps/shops/shop-creator-applications.controller.ts
import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';

import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreatorApprovalStatus } from '@prisma/client';
import { ShopAuthService } from './shop-auth.service';
import { ShopLicenseApprovedGuard } from '../access-control/shop-license-approved.guard';

@UseGuards(JwtAuthGuard, ShopLicenseApprovedGuard)
@Controller()
export class ShopCreatorApplicationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shopAuth: ShopAuthService,
  ) {}

  /**
   * GET /shop/creator-applications?status=pending|approved|rejected...
   * - 自分の所属shopの申請一覧（カーソル対応）
   */
  @Get('shops/creator-applications')
  async listCreatorApplications(
    @Req() req: Request,
    @Query('status') status?: string,
    @Query('take') takeStr?: string,
    @Query('cursor') cursor?: string,
  ) {
    const { shopId } = await this.shopAuth.getMyShopMemberOrThrow(req);

    const take = Math.min(Math.max(Number(takeStr ?? 50), 1), 200);
    const st =
      (status as CreatorApprovalStatus | undefined) ??
      CreatorApprovalStatus.pending;

    const items = await this.prisma.creatorApplication.findMany({
      where: { shopId, status: st },
      orderBy: { createdAt: 'desc' },
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        creator: {
          include: {
            user: { select: { id: true, email: true } },
          },
        },
        shop: { select: { id: true, name: true } },
      },
    });

    const nextCursor = items.length === take ? items[items.length - 1].id : null;
    return { items, nextCursor };
  }

  /**
   * 旧: GET /shops/:shopId/creator-applications?status=...
   * - フロント互換用（ページング無しの簡易版として残す）
   */
  @Get('shops/:shopId/creator-applications')
  async listCreatorApplicationsCompat(
    @Req() req: Request,
    @Param('shopId') shopId: string,
    @Query('status') status?: CreatorApprovalStatus,
  ) {
    await this.shopAuth.assertMyShopIdMatchesOrThrow(req, shopId, [
      'owner',
      'admin',
    ]);

    const applications = await this.prisma.creatorApplication.findMany({
      where: { shopId, ...(status && { status }) },
      include: {
        creator: {
          select: {
            userId: true,
            publicName: true,
            user: {
              select: {
                email: true,
                profile: { select: { displayName: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return applications.map((a) => ({
      id: a.id,
      status: a.status,
      publicName: a.publicName,
      createdAt: a.createdAt,
      creator: {
        userId: a.creator.userId,
        displayName:
          a.creator.user.profile?.displayName ?? a.creator.publicName,
        email: a.creator.user.email,
      },
    }));
  }
}
