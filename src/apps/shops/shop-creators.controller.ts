// api/src/apps/shops/shop-creators.controller.ts
import {
  Controller,
  Get,
  Param,
  Req,
  BadRequestException,
  ForbiddenException,
  UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('shops')
export class ShopCreatorsController {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  @Get(':shopId/creators')
  async listCreators(
    @Req() req: Request,
    @Param('shopId') shopId: string,
  ) {
    const userId = String((req as any).user?.id ?? '');
    if (!userId) throw new BadRequestException('ログイン情報が取得できません');

    // 権限チェック
    const member = await this.prisma.shopMember.findUnique({
      where: {
        shopId_userId: {
          shopId,
          userId,
        },
      },
    });

    if (!member || !['owner', 'admin'].includes(member.role)) {
      throw new ForbiddenException('Shop 管理権限がありません');
    }

    // 所属 Creator 一覧
    const creators = await this.prisma.creator.findMany({
      where: {
        shopId,
        approvalStatus: 'approved',
      },
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
            profile: {
              select: {
                displayName: true,
                avatarUrl: true,
              },
            },
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
