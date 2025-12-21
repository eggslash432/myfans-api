// api/src/apps/admin/admin-shops.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

function clampTake(raw: any, def = 20, min = 1, max = 50) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

@Injectable()
export class AdminShopsService {
  constructor(private readonly prisma: PrismaService) {}

  // ----------------------------
  // GET /admin/shops
  // ----------------------------
  async listShops(params: { q?: string; take?: string; cursor?: string }) {
    const take = clampTake(params.take, 20, 1, 50);
    const q = (params.q ?? '').trim();
    const cursor = (params.cursor ?? '').trim();

    // createdAt desc, id desc で安定ソート
    const where: any = {};
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        // 必要なら他項目も
      ];
    }

    const rows = await this.prisma.shop.findMany({
      where,
      take: take + 1,
      ...(cursor
        ? {
            skip: 1,
            cursor: { id: cursor },
          }
        : {}),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        name: true,
        createdAt: true,
        _count: { select: { members: true } },
        members: {
          where: { role: 'owner' },
          take: 1,
          select: {
            userId: true,
            user: { select: { email: true } },
          },
        },
      },
    });

    const hasNext = rows.length > take;
    const items = (hasNext ? rows.slice(0, take) : rows).map((s) => ({
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

  // ----------------------------
  // GET /admin/users
  // ----------------------------
  async listUsers(params: { q?: string; take?: string; cursor?: string }) {
    const take = clampTake(params.take, 20, 1, 50);
    const q = (params.q ?? '').trim();
    const cursor = (params.cursor ?? '').trim();

    const where: any = {};
    if (q) {
      where.OR = [
        { email: { contains: q, mode: 'insensitive' } },
        // profile が無い環境ならこのORは消してOK
        { profile: { is: { displayName: { contains: q, mode: 'insensitive' } } } },
      ];
    }

    const rows = await this.prisma.user.findMany({
      where,
      take: take + 1,
      ...(cursor
        ? {
            skip: 1,
            cursor: { id: cursor },
          }
        : {}),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
        profile: { select: { displayName: true } },
      },
    });

    const hasNext = rows.length > take;
    const items = (hasNext ? rows.slice(0, take) : rows).map((u) => ({
      id: u.id,
      email: u.email,
      role: u.role,
      isActive: u.isActive,
      createdAt: u.createdAt,
      displayName: u.profile?.displayName ?? null,
    }));

    return {
      items,
      nextCursor: hasNext ? items[items.length - 1]?.id ?? null : null,
    };
  }

  // ----------------------------
  // GET /admin/shops/:shopId/members
  // ----------------------------
  async listShopMembers(shopId: string) {
    // shop存在チェック（分かりやすく）
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
        user: {
          select: {
            email: true,
            profile: { select: { displayName: true } },
          },
        },
      },
    });

    return {
      items: rows.map((m) => ({
        userId: m.userId,
        role: m.role as 'owner' | 'admin' | 'staff',
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
        email: m.user.email,
        displayName: m.user.profile?.displayName ?? null,
      })),
    };
  }

  // ----------------------------
  // POST /admin/shops/:shopId/members
  //  - ownerは1人制：既存ownerはstaffへ
  // ----------------------------
  async upsertShopMember(shopId: string, input: { userId: string; role: 'owner' | 'admin' | 'staff' }) {
    // shop存在チェック
    const shop = await this.prisma.shop.findUnique({
      where: { id: shopId },
      select: { id: true },
    });
    if (!shop) throw new NotFoundException('shopが見つかりません');

    // user存在チェック
    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('userが見つかりません');

    const member = await this.prisma.$transaction(async (tx) => {
      if (input.role === 'owner') {
        // ✅ 既存ownerを staff に落とす（対象ユーザー以外）
        await tx.shopMember.updateMany({
          where: { shopId, role: 'owner', userId: { not: input.userId } },
          data: { role: 'staff' },
        });
      }

      const upserted = await tx.shopMember.upsert({
        where: { shopId_userId: { shopId, userId: input.userId } },
        update: { role: input.role },
        create: { shopId, userId: input.userId, role: input.role },
        select: {
          userId: true,
          role: true,
          createdAt: true,
          updatedAt: true,
          user: {
            select: {
              email: true,
              profile: { select: { displayName: true } },
            },
          },
        },
      });

      return upserted;
    });

    return {
      ok: true,
      member: {
        userId: member.userId,
        role: member.role as 'owner' | 'admin' | 'staff',
        createdAt: member.createdAt,
        updatedAt: member.updatedAt,
        email: member.user.email,
        displayName: member.user.profile?.displayName ?? null,
      },
    };
  }

  // ----------------------------
  // DELETE /admin/shops/:shopId/members/:userId
  // ----------------------------
  async removeShopMember(shopId: string, userId: string) {
    // shop存在チェック（任意）
    const shop = await this.prisma.shop.findUnique({
      where: { id: shopId },
      select: { id: true },
    });
    if (!shop) throw new NotFoundException('shopが見つかりません');

    await this.prisma.shopMember.deleteMany({
      where: { shopId, userId },
    });

    return { ok: true };
  }

  // ----------------------------
  // POST /admin/shops/:shopId/restore-owner
  // body userId省略なら自分をowner
  // ----------------------------
  async restoreOwner(shopId: string, userId: string) {
    return this.upsertShopMember(shopId, { userId, role: 'owner' });
  }
}
