// api/src/apps/admin/admin.service.ts

import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  async getDashboardSummary() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // 1. 月間のプラットフォーム売上合計
    const platformRevenueAgg = await this.prisma.payment.aggregate({
      where: {
        paidAt: { gte: startOfMonth },
        paymentStatus: 'paid',
      },
      _sum: {
        platformAmountJpy: true,
      },
    });

    const monthlyRevenue = platformRevenueAgg._sum.platformAmountJpy ?? 0;

    // 2. 新規登録数
    const newUsers = await this.prisma.user.count({
      where: {
        createdAt: { gte: startOfMonth },
      },
    });

    // 3. 通報（未対応）
    const pendingReports = await this.prisma.report.count({
      where: {
        status: 'pending',
      },
    });

    return {
      monthlyRevenue,
      newUsers,
      pendingReports,
    };
  }
}
