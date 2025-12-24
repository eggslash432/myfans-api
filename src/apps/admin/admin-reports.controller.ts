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
import { AdminReportsQueryDto } from './dto/admin-reports.query';
import { buildReportQuery } from './admin-reports.service';
import { ReportStatus } from '@prisma/client';

@UseGuards(JwtAuthGuard, AdminOnlyGuard)
@Controller('admin/reports')
export class AdminReportsController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 通報一覧（filter/sort/paging）
   * GET /admin/reports?status=pending&sortBy=createdAt&sortDir=desc&page=1&pageSize=50
   */
  @Get()
  async listReports(@Query() q: AdminReportsQueryDto) {
    const page = q.page ?? 1;
    const pageSize = Math.min(q.pageSize ?? 50, 200);
    const skip = (page - 1) * pageSize;
    const take = pageSize;

    const { where, orderBy } = buildReportQuery(q);

    const [total, reports] = await this.prisma.$transaction([
      this.prisma.report.count({ where }),
      this.prisma.report.findMany({
        where,
        orderBy,
        skip,
        take,
        include: {
          post: {
            select: {
              id: true,
              title: true,
              publishedStatus: true,
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
      }),
    ]);

    return {
      page,
      pageSize,
      total,
      items: reports.map((r) => ({
        id: r.id,
        postId: r.postId,
        postTitle: r.post?.title ?? '',
        postPublishedStatus: (r.post as any)?.publishedStatus ?? null,
        creatorName:
          r.post?.creator?.publicName ??
          r.post?.creator?.user?.email ??
          '',
        reporterId: r.userId,
        reporterEmail: r.user?.email ?? '',
        reason: r.reason,
        status: r.status,
        createdAt: r.createdAt,
      })),
    };
  }

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
   * PATCH /admin/reports/:id/resolve
   */
  @Patch(':id/resolve')
  async resolveReport(@Param('id') id: string, @Body() body: ResolveReportDto) {
    const { action } = body;

    // ResolveReportDto が IsIn で絞っているので基本ここは通らないが保険
    if (!['reviewed', 'dismissed'].includes(action)) {
      throw new BadRequestException('invalid action');
    }

    const updated = await this.prisma.report.update({
      where: { id },
      data: { status: action as ReportStatus },
    });

    return { ok: true, report: updated };
  }
}
