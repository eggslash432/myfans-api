// api/src/apps/shops/shop-create.controller.ts
import { Body, Controller, ForbiddenException, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { ShopAuthService } from './shop-auth.service';

@UseGuards(JwtAuthGuard)
@Controller('shop')
export class ShopCreateController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shopAuth: ShopAuthService,
  ) {}

  @Post()
  async createShop(@Req() req: Request, @Body() body: { name: string }) {
    const userId = this.shopAuth.requireUserId(req);

    if (!body?.name?.trim()) throw new ForbiddenException('Shop名が必要です');

    // 既に所属してたら作らせない（運用ポリシー次第で変更OK）
    const existing = await this.prisma.shopMember.findFirst({
      where: { userId },
      select: { id: true, shopId: true },
    });
    if (existing) return { ok: true, shopId: existing.shopId, already: true };

    // ✅ Shop作成 → ownerとして紐付け（トランザクション）
    const created = await this.prisma.$transaction(async (tx) => {
      const shop = await tx.shop.create({
        data: {
          name: body.name.trim(),
        },
        select: { id: true, name: true },
      });

      await tx.shopMember.create({
        data: { userId, shopId: shop.id, role: 'owner' },
        select: { id: true },
      });

      return shop;
    });

    return { ok: true, shop: created, already: false };
  }
}
