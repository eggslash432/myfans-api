// api/src/apps/admin/admin-reports.controller.ts

import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  UseGuards,
  BadRequestException,
  Query,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminOnlyGuard } from '../access-control/admin-only.guard';
import { ResolveReportDto } from './dto/resolve-reports.dto';

@UseGuards(JwtAuthGuard, AdminOnlyGuard)
@Controller('admin/reports')
export class AdminReportsController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 通報一覧
   * - 管理画面の「通報一覧」タブ用
   * - ?postId=... で投稿単位の通報だけ取得できるようにする（AdminPostsの通報モーダル用）
   * - ?status=reviewed|dismissed などで絞りたい場合にも備える（任意）
   */
  @Get()
  async listReports(
    @Query('postId') postId?: string,
    @Query('status') status?: string,
  ) {
    const where: any = {};
    if (postId) where.postId = postId;
    if (status) where.status = status;

    const reports = await this.prisma.report.findMany({
      where: Object.keys(where).length ? where : undefined,
      orderBy: { createdAt: 'desc' },
      include: {
        post: {
          select: {
            id: true,
            title: true,
            publishedStatus: true, // ✅ 追加：投稿ステータス
            creator: {
              select: {
                publicName: true,
                user: { select: { email: true } },
              },
            },
          },
        },
        user: { select: { id: true, email: true } },
      },
    });

    return reports.map((r) => ({
      id: r.id,
      postId: r.postId,
      postTitle: r.post?.title ?? '',
      postPublishedStatus: (r.post as any)?.publishedStatus ?? null, // ✅ 追加
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

  /** 通報詳細（必要なら） */
  @Get(':id')
  async getReport(@Param('id') id: string) {
    const report = await this.prisma.report.findUnique({
      where: { id },
      include: { post: true, user: true },
    });

    if (!report) throw new BadRequestException('通報が見つかりません');
    return report;
  }

  /**
   * 通報対応（reviewed / dismissed）
   * PATCH /api/admin/reports/:id/resolve
   * body: { action: "reviewed" | "dismissed" }
   */
  @Patch(':id/resolve')
  async resolveReport(@Param('id') id: string, @Body() body: ResolveReportDto) {
    const { action } = body;

    // DTOで弾けるなら本当は不要だけど、保険で残してOK
    if (!['reviewed', 'dismissed'].includes(action)) {
      throw new BadRequestException('invalid action');
    }

    const updated = await this.prisma.report.update({
      where: { id },
      data: { status: action },
    });

    return { ok: true, report: updated };
  }
}
