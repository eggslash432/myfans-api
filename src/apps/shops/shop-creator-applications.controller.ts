// api/src/apps/shops/shop-creator-applications.controller.ts
import {
  Controller,
  Get,
  Param,
  Req,
  ForbiddenException,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatorApprovalStatus } from '@prisma/client';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';


@UseGuards(JwtAuthGuard)
@Controller('shops')
export class ShopCreatorApplicationsController {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Shop に来ている Creator 申請一覧（pending）
   */
  @Get(':shopId/creator-applications')
  async list(
    @Req() req: Request,
    @Param('shopId') shopId: string,
  ) {
    const userId = String((req as any).user?.id ?? '');
    if (!userId) throw new BadRequestException('ログイン情報が取得できません');

    // ① 権限チェック（Shop管理者）
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

    // ② 申請一覧取得
    const applications = await this.prisma.creatorApplication.findMany({
      where: {
        shopId,
        status: CreatorApprovalStatus.pending,
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        id: true,
        userId: true,
        publicName: true,
        bankAccount: true,
        createdAt: true,
        creator: {
          select: {
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
        },
      },
    });

    return applications.map((a) => ({
      id: a.id,
      userId: a.userId,
      publicName: a.publicName,
      displayName: a.creator.user.profile?.displayName ?? null,
      avatarUrl: a.creator.user.profile?.avatarUrl ?? null,
      email: a.creator.user.email,
      bankAccount: a.bankAccount,
      createdAt: a.createdAt,
    }));
  }
}
