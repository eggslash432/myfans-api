// api/src/apps/admin/admin-summary.controller.ts
import { Controller, Get, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminOnlyGuard } from '../access-control/admin-only.guard';
import { PaymentStatus, ReportStatus } from '@prisma/client';

@UseGuards(JwtAuthGuard, AdminOnlyGuard)
@Controller('admin/summary')
export class AdminSummaryController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async getSummary() {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const paymentsAgg = await this.prisma.payment.aggregate({
      where: {
        paidAt: { gte: monthStart },
        paymentStatus: PaymentStatus.paid,
      },
      _sum: {
        amountJpy: true,
        platformAmountJpy: true,
        shopAmountJpy: true,
        creatorAmountJpy: true,
      },
    });

    const pendingReports = await this.prisma.report.count({
      where: { status: ReportStatus.pending },
    });

    // 以下はそのまま
    const gmvMonthly = paymentsAgg._sum.amountJpy ?? 0;
    const platformSalesMonthly = paymentsAgg._sum.platformAmountJpy ?? 0;
    const shopSalesMonthly = paymentsAgg._sum.shopAmountJpy ?? 0;
    const creatorSalesMonthly = paymentsAgg._sum.creatorAmountJpy ?? 0;

    const newUsers = await this.prisma.user.count({
      where: { createdAt: { gte: monthStart } },
    });

    return {
      salesMonthly: platformSalesMonthly,
      newUsersMonthly: newUsers,
      reportsPending: pendingReports,
      gmvMonthly,
      platformSalesMonthly,
      shopSalesMonthly,
      creatorSalesMonthly,
    };
  }
}
