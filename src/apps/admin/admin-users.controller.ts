// api/src/apps/admin/admin-users.controller.ts

import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminOnlyGuard } from '../access-control/admin-only.guard';
import { PrismaService } from '../prisma/prisma.service';
  import { Role } from '@prisma/client';
import { UserJwt } from 'src/shared/types';

type UpdateAdminUserDto = {
  role?: Role;
  isGeneralAdmin?: boolean;
};

// 追加: ページングユーティリティ（controller内でもOK）
function clampTake(raw: any, def = 20, min = 1, max = 50) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

@UseGuards(JwtAuthGuard, AdminOnlyGuard)
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 管理画面用：管理者ユーザー一覧
   */
  @Get()
  async listUsers() {
    const users = await this.prisma.user.findMany({
      where: {
        // admin / sub_admin だけ
        role: { in: [Role.admin, Role.sub_admin] },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
      },
    });

    return { items: users };
  }

  /**
   * 管理画面用：ユーザーの基本情報更新（今は使わないなら残しておいてもOK）
   */
  @Patch(':id')
  async updateUser(
    @Param('id') id: string,
    @Body() dto: UpdateAdminUserDto,
  ) {
    const data: any = {};

    if (dto.role) {
      data.role = dto.role;
    }
    if (typeof dto.isGeneralAdmin === 'boolean') {
      data.isGeneralAdmin = dto.isGeneralAdmin;
    }

    const user = await this.prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        role: true,
      },
    });

    return { ok: true, user };
  }

  /**
   * 管理画面用：ロール変更（admin / sub_admin 切り替え専用）
   * PATCH /admin/users/:id/role
   */
  @Patch(':id/role')
  async updateAdminRole(
    @Param('id') targetUserId: string,
    @Body() body: { role: Role },
    @Req() req: any,
  ) {
    const me = req.user as UserJwt;
    const nextRole = body.role;

    // 1) 自分自身の権限は変更不可
    if (me.id === targetUserId) {
      throw new ForbiddenException('自分自身の権限は変更できません。');
    }

    // 2) 対象ユーザー取得（admin/sub_admin 以外は弾く）
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, role: true },
    });

    if (!target || (target.role !== Role.admin && target.role !== Role.sub_admin)) {
      throw new NotFoundException('対象の管理者アカウントが見つかりません。');
    }

    // 3) 「最後の admin 」を admin 以外に変更するのを禁止
    if (target.role === Role.admin && nextRole !== Role.admin) {
      const adminCount = await this.prisma.user.count({
        where: { role: Role.admin },
      });

      if (adminCount <= 1) {
        throw new ForbiddenException(
          '最後の管理者アカウントの権限は変更できません。',
        );
      }
    }

    // 4) 更新
    const updated = await this.prisma.user.update({
      where: { id: targetUserId },
      data: { role: nextRole },
      select: { id: true, email: true, role: true },
    });

    return { ok: true, user: updated };
  }  

  /**
   * ✅ ③用：任意ユーザー検索
   * GET /admin/users/search?q=xxx&take=20&cursor=user_...
   */
  @Get('search')
  async searchUsers(
    @Query('q') q?: string,
    @Query('take') takeRaw?: string,
    @Query('cursor') cursor?: string,
  ) {
    const take = clampTake(takeRaw, 20, 1, 50);
    const keyword = (q ?? '').trim();
    const cur = (cursor ?? '').trim();

    const where: any = {};
    if (keyword) {
      where.OR = [
        { email: { contains: keyword, mode: 'insensitive' } },
        // profile が無い/弱いならここ消してOK
        { profile: { is: { displayName: { contains: keyword, mode: 'insensitive' } } } },
      ];
    } else {
      // キーワード無しで全件は重いので、空なら空返しでもいい
      // ここは好み：空なら最新50件返すでもOK
    }

    const rows = await this.prisma.user.findMany({
      where,
      take: take + 1,
      ...(cur ? { skip: 1, cursor: { id: cur } } : {}),
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
    const slice = hasNext ? rows.slice(0, take) : rows;

    const items = slice.map((u) => ({
      id: u.id,
      email: u.email,
      displayName: u.profile?.displayName ?? null,
      role: u.role,
      isActive: u.isActive,
      createdAt: u.createdAt,
    }));

    return {
      items,
      nextCursor: hasNext ? items[items.length - 1]?.id ?? null : null,
    };
  }  
}
