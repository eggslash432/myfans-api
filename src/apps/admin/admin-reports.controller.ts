// src/apps/admin/admin-reports.controller.ts

import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminOnlyGuard } from '../access-control/admin-only.guard';

type ResolveAction = 'reviewed' | 'dismissed';

class ResolveReportBody {
  action!: ResolveAction;
}

@UseGuards(JwtAuthGuard, AdminOnlyGuard)
@Controller('api/admin/reports')
export class AdminReportsController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 通報一覧
   * - 管理画面の「通報一覧」タブ用
   */
  @Get()
  async listReports() {
    const reports = await this.prisma.report.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        post: {
          select: {
            id: true,
            title: true,
            creator: {
              select: {
                publicName: true,
                user: {
                  select: {
                    email: true,
                  },
                },
              },
            },
          },
        },
        user: {
          select: {
            id: true,
            email: true,
          },
        },
      },
    });

    return reports.map((r) => ({
      id: r.id,
      postId: r.postId,
      postTitle: r.post?.title ?? '',
      creatorName:
        r.post?.creator?.publicName ??
        r.post?.creator?.user?.email ??
        '',
      reporterId: r.userId,
      reporterEmail: r.user?.email ?? '',
      reason: r.reason,
      status: r.status,
      createdAt: r.createdAt,
    }));
  }

  /**
   * 通報詳細（必要なら）
   */
  @Get(':id')
  async getReport(@Param('id') id: string) {
    const report = await this.prisma.report.findUnique({
      where: { id },
      include: {
        post: true,
        user: true,
      },
    });

    if (!report) {
      throw new BadRequestException('通報が見つかりません');
    }

    return report;
  }

  /**
   * 通報対応（reviewed / dismissed に更新）
   *
   * フロントから:
   * PATCH /api/admin/reports/:id/resolve
   * { "action": "reviewed" } or { "action": "dismissed" }
   */
  @Patch(':id/resolve')
  async resolveReport(
    @Param('id') id: string,
    @Body() body: ResolveReportBody,
  ) {
    const { action } = body;

    if (!['reviewed', 'dismissed'].includes(action)) {
      throw new BadRequestException('invalid action');
    }

    const updated = await this.prisma.report.update({
      where: { id },
      data: {
        status: action, // Report.status は String なのでそのまま入れる
      },
    });

    return {
      ok: true,
      report: updated,
    };
  }
}
