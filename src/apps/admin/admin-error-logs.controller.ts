// api/src/apps/admin/admin-error-logs.controller.ts

import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminOnlyGuard } from '../access-control/admin-only.guard';
import { PrismaService } from '../prisma/prisma.service';

@UseGuards(JwtAuthGuard, AdminOnlyGuard)
@Controller('admin/error-logs')
export class AdminErrorLogsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(
    @Query('take') takeRaw?: string,
    @Query('cursor') cursorRaw?: string,
    @Query('q') q?: string, // message/path 検索
    @Query('statusCode') statusCodeRaw?: string,
    @Query('userId') userId?: string,
    @Query('path') path?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const take = Math.min(Math.max(Number(takeRaw ?? 50) || 50, 1), 200);
    const cursor = cursorRaw ? Number(cursorRaw) : null;

    const where: any = {};
    const keyword = (q ?? '').trim();
    const statusCode = statusCodeRaw ? Number(statusCodeRaw) : null;

    if (keyword) {
      where.OR = [
        { message: { contains: keyword, mode: 'insensitive' } },
        { path: { contains: keyword, mode: 'insensitive' } },
      ];
    }
    if (Number.isFinite(statusCode as any)) where.statusCode = statusCode;
    if (userId) where.userId = userId;
    if (path) where.path = { contains: path, mode: 'insensitive' };

    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const rows = await this.prisma.errorLog.findMany({
      where,
      orderBy: { id: 'desc' },
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        createdAt: true,
        level: true,
        message: true,
        name: true,
        stack: true,
        statusCode: true,
        method: true,
        path: true,
        userId: true,
        role: true,
        ip: true,
        userAgent: true,
        meta: true,
      },
    });

    const nextCursor = rows.length ? rows[rows.length - 1].id : null;
    return { rows, nextCursor };
  }
}
