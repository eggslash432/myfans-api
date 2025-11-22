// src/apps/admin/admin-reports.controller.ts
import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
// プロジェクトの実装に合わせて Role Guard を調整
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ResolveReportDto } from './dto/resolve-reports.dto';

@Controller('admin/reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminReportsController {
  constructor(private readonly prisma: PrismaService) {}

  // 未対応の通報一覧
  @Get()
  async listPending() {
    return this.prisma.report.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'desc' },
      include: {
        post: {
          select: { id: true, title: true, creatorId: true, publishedStatus: true },
        },
        user: {
          select: { id: true, email: true },
        },
      },
    });
  }

  // 通報対応（対応済み or 却下）
  @Patch(':id/resolve')
  async resolve(@Param('id') id: string, @Body() dto: ResolveReportDto) {
    if (!['reviewed', 'dismissed'].includes(dto.action)) {
      throw new Error('invalid action');
    }

    return this.prisma.report.update({
      where: { id },
      data: {
        status: dto.action,
      },
    });
  }
}
