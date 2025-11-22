// src/apps/admin/admin.posts.controller.ts
import {
  Controller,
  Get,
  Delete,
  Patch,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminOnlyGuard } from '../access-control/admin-only.guard';
import { PublishedStatus } from '@prisma/client';

@Controller('api/admin/posts')
@UseGuards(JwtAuthGuard, AdminOnlyGuard)
export class AdminPostsController {
  constructor(private prisma: PrismaService) {}

  // 全投稿一覧
  @Get()
  async list() {
    return this.prisma.post.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        creator: {
          select: {
            publicName: true,
            userId: true,
          },
        },
      },
    });
  }

  // 投稿削除
  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.prisma.post.delete({
      where: { id },
    });
    return { ok: true };
  }

  // 公開・非公開切替
  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() body: { publishedStatus: PublishedStatus },
  ) {
    const updated = await this.prisma.post.update({
      where: { id },
      data: {
        publishedStatus: body.publishedStatus,
      },
    });
    return updated;
  }

  // 通報一覧
  @Get(':id/reports')
  async getReports(@Param('id') id: string) {
    return this.prisma.report.findMany({
      where: { postId: id },
      orderBy: { createdAt: 'desc' },
    });
  }

  // 通報対応済みにする
  @Patch('reports/:reportId/resolve')
  async resolveReport(@Param('reportId') reportId: string) {
    await this.prisma.report.update({
      where: { id: reportId },
      data: {
        status: 'reviewed',   // ← ここだけ修正
      },
    });
    return { ok: true };
  }

}
