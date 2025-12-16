// api/src/apps/creators/me-creator-applications.controller.ts
import {
  Controller,
  Get,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { Request } from 'express';

@Controller('me')
export class MeCreatorApplicationsController {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  @Get('creator-applications')
  async listMine(@Req() req: Request) {
    const userId = String((req as any).user?.id ?? '');
    if (!userId) throw new BadRequestException('ログイン情報が取得できません');

    const apps = await this.prisma.creatorApplication.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        shopId: true,
        status: true,
        rejectReason: true,
        publicName: true,
        createdAt: true,
        shop: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    return apps.map((a) => ({
      id: a.id,
      status: a.status,
      rejectReason: a.rejectReason,
      createdAt: a.createdAt,

      shop: a.shop
        ? { id: a.shop.id, name: a.shop.name }
        : a.shopId
          ? { id: a.shopId, name: null }
          : null,

      publicName: a.publicName,
    }));
  }
}
