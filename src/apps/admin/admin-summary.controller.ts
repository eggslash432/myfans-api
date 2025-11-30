// api/src/apps/admin/admin-summary.controller.ts

import { Controller, Get, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminOnlyGuard } from '../access-control/admin-only.guard';

@UseGuards(JwtAuthGuard, AdminOnlyGuard)
@Controller('api/admin/summary')
export class AdminSummaryController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async getSummary() {
    // 月初
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    // 月間売上（payment）
    const payments = await this.prisma.payment.aggregate({
      where: { createdAt: { gte: monthStart } },
      _sum: { amountJpy: true },
    });

    // 月間新規ユーザー
    const newUsers = await this.prisma.user.count({
      where: { createdAt: { gte: monthStart } },
    });

    // 未対応通報数
    const pendingReports = await this.prisma.report.count({
      where: { status: 'pending' },
    });

    return {
      salesMonthly: payments._sum.amountJpy ?? 0,
      newUsersMonthly: newUsers,
      reportsPending: pendingReports,
    };
  }
}
