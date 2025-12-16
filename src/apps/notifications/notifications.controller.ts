// api/src/apps/notifications/notifications.controller.ts
import {
  Controller,
  Get,
  Post,
  Param,
  Req,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { Request } from 'express';

@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  // ==============================
  // 通知一覧（自分）
  // GET /notifications/me
  // ==============================
  @Get('me')
  async list(@Req() req: Request) {
    const userId = String((req as any).user?.id ?? '');
    if (!userId) {
      throw new BadRequestException('ログイン情報が取得できません');
    }

    const notifications = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50, // 念のため上限
      select: {
        id: true,
        type: true,
        title: true,
        body: true,
        readAt: true,
        createdAt: true,
      },
    });

    return notifications;
  }

  // ==============================
  // 未読件数（バッジ用）
  // GET /notifications/me/unread-count
  // ==============================
  @Get('me/unread-count')
  async unreadCount(@Req() req: Request) {
    const userId = String((req as any).user?.id ?? '');
    if (!userId) {
      throw new BadRequestException('ログイン情報が取得できません');
    }

    const count = await this.prisma.notification.count({
      where: {
        userId,
        readAt: null,
      },
    });

    return { count };
  }

  // ==============================
  // 通知を既読にする（1件）
  // POST /notifications/:id/read
  // ==============================
  @Post(':id/read')
  async markAsRead(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    const userId = String((req as any).user?.id ?? '');
    if (!userId) {
      throw new BadRequestException('ログイン情報が取得できません');
    }

    const notif = await this.prisma.notification.findUnique({
      where: { id },
      select: { userId: true, readAt: true },
    });

    if (!notif) {
      throw new NotFoundException('通知が存在しません');
    }

    if (notif.userId !== userId) {
      throw new ForbiddenException('この通知を操作する権限がありません');
    }

    if (notif.readAt) {
      return { success: true }; // 既読済み
    }

    await this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });

    return { success: true };
  }

  // ==============================
  // 全件既読
  // POST /notifications/me/read-all
  // ==============================
  @Post('me/read-all')
  async readAll(@Req() req: Request) {
    const userId = String((req as any).user?.id ?? '');
    if (!userId) {
      throw new BadRequestException('ログイン情報が取得できません');
    }

    const result = await this.prisma.notification.updateMany({
      where: {
        userId,
        readAt: null,
      },
      data: {
        readAt: new Date(),
      },
    });

    return {
      success: true,
      updated: result.count,
    };
  }
}
