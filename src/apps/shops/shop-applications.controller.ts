// api/src/apps/shops/shop-applications.controller.ts
import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatorApprovalStatus } from '@prisma/client';
import type { Request } from 'express';

@Controller('shops')
export class ShopApplicationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':shopId/creator-applications')
  async list(
    @Req() req: Request,
    @Param('shopId') shopId: string,
    @Query('status') status?: CreatorApprovalStatus,
  ) {
    const userId = String((req as any).user?.id ?? '');
    if (!userId) throw new ForbiddenException();

    // ① Shop管理者チェック
    const member = await this.prisma.shopMember.findUnique({
      where: {
        shopId_userId: { shopId, userId },
      },
    });

    if (!member || !['owner', 'admin'].includes(member.role)) {
      throw new ForbiddenException('Shop管理権限がありません');
    }

    // ② 申請一覧取得
    const applications = await this.prisma.creatorApplication.findMany({
      where: {
        shopId,
        ...(status && { status }),
      },
      include: {
        creator: {
          select: {
            userId: true,
            publicName: true,
            user: {
              select: {
                email: true,
                profile: {
                  select: { displayName: true },
                },
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
          a.creator.user.profile?.displayName ??
          a.creator.publicName,
        email: a.creator.user.email,
      },
    }));
  }
}
