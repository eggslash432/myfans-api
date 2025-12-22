// api/src/apps/shops/shop-create.controller.ts
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Prisma } from '@prisma/client';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { ShopAuthService } from './shop-auth.service';

@UseGuards(JwtAuthGuard)
@Controller('shops')
export class ShopCreateController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shopAuth: ShopAuthService,
  ) {}

  /**
   * ✅ Shop（店舗）作成：運営管理者のみ
   * POST /shops
   */
  @Post()
  async createShop(
    @Req() req: Request,
    @Body() body: { name: string; ownerUserId?: string | null },
  ) {
    await this.shopAuth.assertPlatformAdminOrThrow(req);

    const name = String(body?.name ?? '').trim();
    if (!name) throw new BadRequestException('Shop名が必要です');

    const ownerUserId =
      typeof body.ownerUserId === 'string' && body.ownerUserId.trim()
        ? body.ownerUserId.trim()
        : null;

    try {
      // ✅ 事前チェック：同名shop（ユニークならここで防止）
      const exists = await this.prisma.shop.findFirst({
        where: { name },
        select: { id: true },
      });
      if (exists) {
        throw new ConflictException('同名のShopが既に存在します');
      }

      const created = await this.prisma.$transaction(async (tx) => {
        // ① shop 作成
        const shop = await tx.shop.create({
          data: { name },
          select: { id: true, name: true },
        });

        // ② owner を紐付け
        if (ownerUserId) {
          const ownerExists = await tx.user.findUnique({
            where: { id: ownerUserId },
            select: { id: true },
          });
          if (!ownerExists) throw new BadRequestException('ownerUserId が存在しません');

          // ✅ 事前チェック：このユーザーが既に ShopMember なら分かりやすく弾く
          const alreadyMember = await tx.shopMember.findFirst({
            where: { userId: ownerUserId },
            select: { id: true, shopId: true, role: true },
          });
          if (alreadyMember) {
            throw new ConflictException(
              'このユーザーは既に別のShopに所属しています（先に解除/移動してください）',
            );
          }

          await tx.shopMember.create({
            data: { userId: ownerUserId, shopId: shop.id, role: 'owner' },
            select: { id: true },
          });
        }

        return shop;
      });

      return { ok: true, shop: created };
    } catch (e: any) {
      // ✅ Prisma のユニーク制約などを人間向けに変換
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === 'P2002') {
          // unique constraint failed
          throw new ConflictException('一意制約により作成できません（重複の可能性）');
        }
        if (e.code === 'P2003') {
          // foreign key constraint failed
          throw new BadRequestException('関連データの整合性エラーです（ownerUserId等を確認）');
        }
      }
      // 既にHTTP例外ならそのまま返す
      throw e;
    }
  }
}
