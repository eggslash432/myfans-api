import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminOnlyGuard } from '../access-control/admin-only.guard';
import { PrismaService } from '../prisma/prisma.service';

@UseGuards(JwtAuthGuard, AdminOnlyGuard)
@Controller('admin/audit-logs')
export class AdminAuditLogsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(
    @Query('take') takeRaw?: string,
    @Query('cursor') cursorRaw?: string, // id cursor

    @Query('action') action?: string,

    // 既存：ID直指定
    @Query('actorId') actorId?: string,
    @Query('targetType') targetType?: string,
    @Query('targetId') targetId?: string,

    // ✅ 追加：email部分一致で検索（Userを引いてIDに変換）
    @Query('actorQ') actorQ?: string,
    @Query('targetQ') targetQ?: string,

    @Query('from') from?: string, // ISO Date string
    @Query('to') to?: string,     // ISO Date string
  ) {
    const take = Math.min(Math.max(Number(takeRaw ?? 50) || 50, 1), 200);
    const cursor = cursorRaw ? Number(cursorRaw) : null;

    const where: any = {};

    if (action) where.action = action;
    if (targetType) where.targetType = targetType;

    // createdAt 範囲（任意）
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    // ----------------------------
    // ✅ actorQ がある場合：email→userId[] へ変換し actorId IN
    //  - actorQ が無い場合：従来どおり actorId 直指定
    // ----------------------------
    const actorKeyword = (actorQ ?? '').trim();
    if (actorKeyword) {
      const users = await this.prisma.user.findMany({
        where: { email: { contains: actorKeyword, mode: 'insensitive' } },
        select: { id: true },
        take: 50, // 大量一致の暴走防止
      });
      const ids = users.map((u) => u.id);
      where.actorId = ids.length ? { in: ids } : '__NO_MATCH__'; // 0件ならヒット0にする
    } else if (actorId) {
      where.actorId = actorId;
    }

    // ----------------------------
    // ✅ targetQ がある場合：email→userId[] へ変換し targetId IN
    //  - targetQ は「ユーザー対象」を想定（targetType=Userに寄せる）
    //  - targetQ が無い場合：従来どおり targetId 直指定
    // ----------------------------
    const targetKeyword = (targetQ ?? '').trim();
    if (targetKeyword) {
      const users = await this.prisma.user.findMany({
        where: { email: { contains: targetKeyword, mode: 'insensitive' } },
        select: { id: true },
        take: 50,
      });
      const ids = users.map((u) => u.id);

      // targetQ は user検索なので、targetTypeはUserに固定する（手入力よりブレない）
      where.targetType = 'User';
      where.targetId = ids.length ? { in: ids } : '__NO_MATCH__';
    } else if (targetId) {
      where.targetId = targetId;
    }

    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: { id: 'desc' },
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        createdAt: true,
        actorId: true,
        actorRole: true,
        action: true,
        target: true,
        targetType: true,
        targetId: true,
        ip: true,
        userAgent: true,
        meta: true,
      },
    });

    const nextCursor = rows.length ? rows[rows.length - 1].id : null;
    return { rows, nextCursor };
  }
}
