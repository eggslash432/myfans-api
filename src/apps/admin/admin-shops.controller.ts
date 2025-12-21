// api/src/apps/admin/admin-shops.controller.ts
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { AdminUpsertShopMemberDto } from './dto/admin-upsert-shop-member.dto';

@Controller('admin/shops')
@UseGuards(JwtAuthGuard)
export class AdminShopsController {
  constructor(private readonly prisma: PrismaService) {}

  private assertAdmin(req: Request) {
    const role = String((req as any).user?.role ?? '');
    if (role !== 'admin' && role !== 'sub_admin') {
      throw new ForbiddenException('admin権限が必要です');
    }
  }

  private clampTake(raw: any, def = 20, min = 1, max = 50) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return def;
    return Math.max(min, Math.min(max, Math.floor(n)));
  }

  // =========================================
  // ③-1) Shop一覧（shopId手入力をなくす）
  // GET /admin/shops?q=&take=&cursor=
  // =========================================
  @Get()
  async listShops(
    @Req() req: Request,
    @Query('q') q?: string,
    @Query('take') takeRaw?: string,
    @Query('cursor') cursor?: string,
  ) {
    this.assertAdmin(req);

    const take = this.clampTake(takeRaw, 20, 1, 50);
    const keyword = (q ?? '').trim();
    const cur = (cursor ?? '').trim();

    const where: any = {};
    if (keyword) {
      where.OR = [{ name: { contains: keyword, mode: 'insensitive' } }];
    }

    const rows = await this.prisma.shop.findMany({
      where,
      take: take + 1,
      ...(cur ? { skip: 1, cursor: { id: cur } } : {}),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        name: true,
        createdAt: true,
        _count: { select: { members: true } },
        members: {
          where: { role: 'owner' },
          take: 1,
          select: { userId: true, user: { select: { email: true } } },
        },
      },
    });

    const hasNext = rows.length > take;
    const slice = hasNext ? rows.slice(0, take) : rows;

    const items = slice.map((s) => ({
      id: s.id,
      name: s.name,
      createdAt: s.createdAt,
      membersCount: s._count.members,
      ownerUserId: s.members[0]?.userId ?? null,
      ownerEmail: s.members[0]?.user?.email ?? null,
    }));

    return {
      items,
      nextCursor: hasNext ? items[items.length - 1]?.id ?? null : null,
    };
  }

  // =========================================
  // ③-2) ShopMember一覧（現状把握）
  // GET /admin/shops/:shopId/members
  // =========================================
  @Get(':shopId/members')
  async listMembers(@Req() req: Request, @Param('shopId') shopId: string) {
    this.assertAdmin(req);

    const shop = await this.prisma.shop.findUnique({
      where: { id: shopId },
      select: { id: true },
    });
    if (!shop) throw new NotFoundException('shopが見つかりません');

    const rows = await this.prisma.shopMember.findMany({
      where: { shopId },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      select: {
        userId: true,
        role: true,
        createdAt: true,
        updatedAt: true,
        user: { select: { email: true, profile: { select: { displayName: true } } } },
      },
    });

    return {
      items: rows.map((m) => ({
        userId: m.userId,
        role: m.role, // owner/admin/staff
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
        email: m.user.email,
        displayName: m.user.profile?.displayName ?? null,
      })),
    };
  }

  // =========================================
  // ③-3) ShopMember upsert（ownerは1人制）
  // POST /admin/shops/:shopId/members
  // =========================================
  @Post(':shopId/members')
  async upsertMember(
    @Req() req: Request,
    @Param('shopId') shopId: string,
    @Body() dto: AdminUpsertShopMemberDto,
  ) {
    this.assertAdmin(req);

    const shop = await this.prisma.shop.findUnique({
      where: { id: shopId },
      select: { id: true },
    });
    if (!shop) throw new NotFoundException('shopが見つかりません');

    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('userが見つかりません');

    const member = await this.prisma.$transaction(async (tx) => {
      // ✅ owner 付与は 1人制：既存ownerをstaffへ落とす
      if (dto.role === 'owner') {
        await tx.shopMember.updateMany({
          where: { shopId, role: 'owner', userId: { not: dto.userId } },
          data: { role: 'staff' },
        });
      }

      return tx.shopMember.upsert({
        where: { shopId_userId: { shopId, userId: dto.userId } },
        update: { role: dto.role },
        create: { shopId, userId: dto.userId, role: dto.role },
      });
    });

    return { ok: true, member };
  }

  // =========================================
  // ③-4) ShopMember 削除（任意）
  // DELETE /admin/shops/:shopId/members/:userId
  // =========================================
  @Delete(':shopId/members/:userId')
  async deleteMember(
    @Req() req: Request,
    @Param('shopId') shopId: string,
    @Param('userId') userId: string,
  ) {
    this.assertAdmin(req);

    await this.prisma.shopMember.deleteMany({
      where: { shopId, userId },
    });

    return { ok: true };
  }

  // =========================================
  // ①/③-5) 緊急：owner復旧（body省略なら自分）
  // POST /admin/shops/:shopId/restore-owner
  // body: { userId?: string }
  // =========================================
  @Post(':shopId/restore-owner')
  async restoreOwner(
    @Req() req: Request,
    @Param('shopId') shopId: string,
    @Body() body: { userId?: string },
  ) {
    this.assertAdmin(req);

    const myUserId = String((req as any).user?.id ?? '');
    const userId = String(body?.userId ?? myUserId);
    if (!userId) throw new ForbiddenException('userIdが取得できません');

    // shop存在チェック（わかりやすく）
    const shop = await this.prisma.shop.findUnique({
      where: { id: shopId },
      select: { id: true },
    });
    if (!shop) throw new NotFoundException('shopが見つかりません');

    const member = await this.prisma.$transaction(async (tx) => {
      await tx.shopMember.updateMany({
        where: { shopId, role: 'owner', userId: { not: userId } },
        data: { role: 'staff' },
      });

      return tx.shopMember.upsert({
        where: { shopId_userId: { shopId, userId } },
        update: { role: 'owner' },
        create: { shopId, userId, role: 'owner' },
      });
    });

    return { ok: true, member };
  }
}
