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
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminOnlyGuard } from '../access-control/admin-only.guard';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit/audit-log.service';
import { getIp, getUa, makeTarget } from '../audit/audit-log.util';
import { UserJwt } from 'src/shared/types';

type UpdateAdminUserDto = {
  role?: Role;
};

type SetUserActiveDto = {
  isActive: boolean;
  reason?: string;
};

function clampTake(raw: any, def = 20, min = 1, max = 50) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

@UseGuards(JwtAuthGuard, AdminOnlyGuard)
@Controller('admin/users')
export class AdminUsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * 管理画面用：管理者ユーザー一覧（admin/sub_admin）
   */
  @Get()
  async listUsers() {
    const users = await this.prisma.user.findMany({
      where: {
        role: { in: [Role.admin, Role.sub_admin] },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, email: true, role: true, createdAt: true },
    });

    return { items: users };
  }

  /**
   * 管理画面用：ユーザーの基本情報更新（最低限：roleのみ）
   * PATCH /admin/users/:id
   */
  @Patch(':id')
  async updateUser(
    @Param('id') targetUserId: string,
    @Body() dto: UpdateAdminUserDto,
    @Req() req: any,
  ) {
    const me = req.user as UserJwt;

    const data: any = {};
    if (dto.role) data.role = dto.role;

    if (Object.keys(data).length === 0) {
      const current = await this.prisma.user.findUnique({
        where: { id: targetUserId },
        select: { id: true, email: true, role: true, isActive: true },
      });
      if (!current) throw new NotFoundException('対象ユーザーが見つかりません。');
      return { ok: true, user: current };
    }

    // 更新前（監査ログ用）
    const before = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, role: true, isActive: true },
    });
    if (!before) throw new NotFoundException('対象ユーザーが見つかりません。');

    const user = await this.prisma.user.update({
      where: { id: targetUserId },
      data,
      select: { id: true, email: true, role: true, isActive: true },
    });

    await this.audit.write({
      actorId: me.id,
      actorRole: me.role ?? null,
      action: 'ADMIN_USER_UPDATE',
      targetType: 'User',
      targetId: targetUserId,
      target: makeTarget('user', targetUserId),
      ip: getIp(req),
      userAgent: getUa(req),
      meta: {
        changes: {
          role: dto.role ? { from: before.role, to: dto.role } : undefined,
        },
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

    if (me.id === targetUserId) {
      throw new ForbiddenException('自分自身の権限は変更できません。');
    }

    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, role: true },
    });

    if (!target || (target.role !== Role.admin && target.role !== Role.sub_admin)) {
      throw new NotFoundException('対象の管理者アカウントが見つかりません。');
    }

    if (target.role === Role.admin && nextRole !== Role.admin) {
      const adminCount = await this.prisma.user.count({ where: { role: Role.admin } });
      if (adminCount <= 1) {
        throw new ForbiddenException('最後の管理者アカウントの権限は変更できません。');
      }
    }

    const updated = await this.prisma.user.update({
      where: { id: targetUserId },
      data: { role: nextRole },
      select: { id: true, email: true, role: true, isActive: true },
    });

    await this.audit.write({
      actorId: me.id,
      actorRole: me.role ?? null,
      action: 'ADMIN_ROLE_CHANGE',
      targetType: 'User',
      targetId: targetUserId,
      target: makeTarget('user', targetUserId),
      ip: getIp(req),
      userAgent: getUa(req),
      meta: { from: target.role, to: nextRole },
    });

    return { ok: true, user: updated };
  }

  /**
   * ✅ ユーザー凍結/解除
   * PATCH /admin/users/:id/active
   */
  @Patch(':id/active')
  async setUserActive(
    @Param('id') targetUserId: string,
    @Body() dto: SetUserActiveDto,
    @Req() req: any,
  ) {
    const me = req.user as UserJwt;

    if (me.id === targetUserId) {
      throw new ForbiddenException('自分自身は凍結/解除できません。');
    }

    const nextIsActive = !!dto.isActive;

    const before = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, email: true, role: true, isActive: true },
    });
    if (!before) throw new NotFoundException('対象ユーザーが見つかりません。');

    // 管理者は凍結不可（必要なら）
    if ((before.role === Role.admin || before.role === Role.sub_admin) && !nextIsActive) {
      throw new ForbiddenException('管理者アカウントは凍結できません。');
    }

    if (before.isActive === nextIsActive) {
      return { ok: true, user: before };
    }

    const updated = await this.prisma.user.update({
      where: { id: targetUserId },
      data: { isActive: nextIsActive },
      select: { id: true, email: true, role: true, isActive: true },
    });

    await this.audit.write({
      actorId: me.id,
      actorRole: me.role ?? null,
      action: nextIsActive ? 'USER_UNFREEZE' : 'USER_FREEZE',
      targetType: 'User',
      targetId: targetUserId,
      target: makeTarget('user', targetUserId),
      ip: getIp(req),
      userAgent: getUa(req),
      meta: {
        from: before.isActive,
        to: nextIsActive,
        reason: dto.reason ?? null,
      },
    });

    return { ok: true, user: updated };
  }

  /**
   * ✅ 任意ユーザー検索（emailのみ）
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

    // keywordなしは重いので空返しに寄せる（必要なら仕様変更してOK）
    if (!keyword) {
      return { items: [], nextCursor: null };
    }

    const rows = await this.prisma.user.findMany({
      where: {
        email: { contains: keyword, mode: 'insensitive' },
      },
      take: take + 1,
      ...(cur ? { skip: 1, cursor: { id: cur } } : {}),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });

    const hasNext = rows.length > take;
    const slice = hasNext ? rows.slice(0, take) : rows;

    const items = slice.map((u) => ({
      id: u.id,
      email: u.email,
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
