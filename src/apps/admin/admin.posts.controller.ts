// src/apps/admin/admin.posts.controller.ts
import {
  Controller,
  Get,
  Delete,
  Patch,
  Param,
  Body,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminOnlyGuard } from '../access-control/admin-only.guard';
import { PublishedStatus } from '@prisma/client';

@UseGuards(JwtAuthGuard, AdminOnlyGuard)
@Controller('api/admin/posts')
export class AdminPostsController {
  constructor(private readonly prisma: PrismaService) {}

  // 投稿一覧（管理画面用）
  @Get()
  async listPosts() {
    const posts = await this.prisma.post.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        creator: {
          select: {
            userId: true,
            publicName: true,
            user: {
              select: {
                email: true,
              },
            },
          },
        },
        _count: {
          select: {
            reports: true,
          },
        },
      },
    });

    // 管理画面で扱いやすい形に整形
    return posts.map((p) => ({
      id: p.id,
      title: p.title,
      visibility: p.visibility,
      priceJpy: p.priceJpy,
      publishedStatus: p.publishedStatus,
      publishedAt: p.publishedAt,
      createdAt: p.createdAt,
      creatorId: p.creatorId,
      creatorName: p.creator?.publicName ?? p.creator?.user?.email ?? '',
      reportsCount: p._count.reports,
    }));
  }

  // 投稿削除（今回は「非公開化」でソフトデリート扱い）
  @Delete(':id')
  async deletePost(@Param('id') id: string) {
    await this.prisma.post.update({
      where: { id },
      data: {
        publishedStatus: PublishedStatus.private,
      },
    });
    return { ok: true };
  }

  // 投稿ステータス変更（draft / published / private）
  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() body: { status: PublishedStatus },
  ) {
    const { status } = body;
    const allowed = Object.values(PublishedStatus);
    if (!allowed.includes(status)) {
      throw new BadRequestException('invalid status');
    }

    const post = await this.prisma.post.update({
      where: { id },
      data: { publishedStatus: status },
    });

    return post;
  }

  // 特定の投稿に紐づく通報一覧
  @Get(':id/reports')
  async getReports(@Param('id') id: string) {
    const reports = await this.prisma.report.findMany({
      where: { postId: id },
      orderBy: { createdAt: 'desc' },
    });
    return reports;
  }

  // 通報対応済みにする（AdminPostsPage から叩かれている）
  @Patch('reports/:reportId/resolve')
  async resolveReport(@Param('reportId') reportId: string) {
    await this.prisma.report.update({
      where: { id: reportId },
      data: {
        status: 'reviewed', // TODO: 必要なら 'dismissed' 等も分ける
      },
    });
    return { ok: true };
  }
}
