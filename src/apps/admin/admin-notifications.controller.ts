// api/src/apps/admin/admin-notifications.controller.ts

import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminOnlyGuard } from '../access-control/admin-only.guard';
import { NotificationSource, NotificationType } from '@prisma/client';

@UseGuards(JwtAuthGuard, AdminOnlyGuard)
@Controller('admin/notifications')
export class AdminNotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(
    @Query('userId') userId?: string,
    @Query('type') type?: NotificationType,
    @Query('source') source?: NotificationSource,
    @Query('unreadOnly') unreadOnly?: string,
    @Query('take') takeStr?: string,
    @Query('cursor') cursor?: string,
  ) {
    const take = Math.min(Number(takeStr ?? 50) || 50, 200);

    const where: any = {};
    if (userId) where.userId = userId;
    if (type) where.type = type;
    if (source) where.source = source;
    if (unreadOnly === '1' || unreadOnly === 'true') where.readAt = null;

    const rows = await this.prisma.notification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        userId: true,
        type: true,
        source: true,
        title: true,
        body: true,
        readAt: true,
        createdAt: true,
      },
    });

    const hasNext = rows.length > take;
    const items = hasNext ? rows.slice(0, take) : rows;
    const nextCursor = hasNext ? items[items.length - 1]?.id : null;

    return { items, nextCursor };
  }
}
