// api/src/apps/admin/admin-creators.controller.ts

import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminOnlyGuard } from '../access-control/admin-only.guard';

class UpdateListingBody {
  isListed!: boolean;
}

@UseGuards(JwtAuthGuard, AdminOnlyGuard)
@Controller('admin/creators')
export class AdminCreatorsController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * クリエイター一覧
   * - 管理画面の「クリエイター管理」テーブル用
   * - isListed / kycStatus で簡易フィルタ可能
   *
   * 例:
   * GET /api/admin/creators?isListed=true
   * GET /api/admin/creators?kycStatus=pending
   */
  @Get()
  async listCreators(
    @Query('isListed') isListed?: string,
    @Query('kycStatus') kycStatus?: string,
  ) {
    const where: any = {};

    if (typeof isListed === 'string') {
      if (isListed === 'true') where.isListed = true;
      if (isListed === 'false') where.isListed = false;
    }

    if (kycStatus) {
      // Creator.stripeKycStatus は String? なのでそのままマッチ
      where.stripeKycStatus = kycStatus;
    }

    const creators = await this.prisma.creator.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
            isActive: true,
            createdAt: true,
          },
        },
        _count: {
          select: {
            posts: true,
            subscriptions: true,
            payouts: true,
          },
        },
      },
    });

    return creators.map((c) => ({
      userId: c.userId,
      email: c.user?.email ?? '',
      publicName: c.publicName,
      isListed: c.isListed,
      stripeKycStatus: c.stripeKycStatus,
      stripeChargesEnabled: c.stripeChargesEnabled,
      stripePayoutsEnabled: c.stripePayoutsEnabled,
      createdAt: c.createdAt,
      userCreatedAt: c.user?.createdAt,
      postsCount: c._count.posts,
      subsCount: c._count.subscriptions,
      payoutsCount: c._count.payouts,
    }));
  }

  /**
   * クリエイター詳細
   * - 必要であれば詳細モーダルなどから利用
   */
  @Get(':userId')
  async getCreator(@Param('userId') userId: string) {
    const creator = await this.prisma.creator.findUnique({
      where: { userId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
            isActive: true,
            createdAt: true,
          },
        },
        plans: true,
      },
    });

    if (!creator) {
      throw new BadRequestException('クリエイターが見つかりません');
    }

    return creator;
  }

  /**
   * 掲載 ON/OFF 切り替え
   *
   * PATCH /api/admin/creators/:userId/listing
   * { "isListed": true }
   */
  @Patch(':userId/listing')
  async updateListing(
    @Param('userId') userId: string,
    @Body() body: UpdateListingBody,
  ) {
    if (typeof body.isListed !== 'boolean') {
      throw new BadRequestException('isListed は boolean で指定してください');
    }

    const updated = await this.prisma.creator.update({
      where: { userId },
      data: { isListed: body.isListed },
    });

    return {
      ok: true,
      userId: updated.userId,
      isListed: updated.isListed,
    };
  }
}
