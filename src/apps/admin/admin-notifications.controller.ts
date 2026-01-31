// api/src/apps/admin/admin-notifications.controller.ts
import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminOnlyGuard } from '../access-control/admin-only.guard';
import { NotificationSource, NotificationType } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';

@UseGuards(JwtAuthGuard, AdminOnlyGuard)
@Controller('admin/notifications')
export class AdminNotificationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * 通知一覧（管理）
   * GET /admin/notifications?userId=&type=&source=&unreadOnly=true&take=50&skip=0
   */
  @Get()
  async list(
    @Query('userId') userId?: string,
    @Query('type') type?: NotificationType,
    @Query('source') source?: NotificationSource,
    @Query('unreadOnly') unreadOnly?: string,
    @Query('take') takeStr?: string,
    @Query('skip') skipStr?: string,
  ) {
    const take = Math.min(Number(takeStr ?? 50) || 50, 200);
    const skip = Math.max(Number(skipStr ?? 0) || 0, 0);

    const where: any = {};
    if (userId?.trim()) where.userId = userId.trim();
    if (type) where.type = type;
    if (source) where.source = source;
    if (unreadOnly === '1' || unreadOnly === 'true') where.readAt = null;

    const [items, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
        skip,
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
      }),
      this.prisma.notification.count({ where }),
    ]);

    return { items, total };
  }

  /**
   * 手動通知送信（管理者）
   * POST /admin/notifications/send
   * body: { userId, type, title, body }
   *
   * - source は常に ADMIN（改ざん不可）
   */
  @Post('send')
  async send(
    @Body()
    dto: {
      userId: string;
      type: NotificationType | string; // 互換（service側でcoerce）
      title: string;
      body: string;
    },
  ) {
    const userId = String(dto.userId ?? '').trim();
    const title = String(dto.title ?? '').trim();
    const body = String(dto.body ?? '').trim();

    if (!userId) throw new BadRequestException('userId is required');
    if (!title) throw new BadRequestException('title is required');
    if (!body) throw new BadRequestException('body is required');

    // user existence check（運用で地味に助かる）
    const exists = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!exists) throw new BadRequestException('user not found');

    const created = await this.notifications.notify({
      userId,
      type: dto.type,
      source: NotificationSource.ADMIN, // ✅ 強制
      title,
      body,
      force: true,
    });

    return { ok: true, id: created.id, createdAt: created.createdAt };
  }
}
