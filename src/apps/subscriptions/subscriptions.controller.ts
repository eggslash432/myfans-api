// src/apps/subscriptions/subscriptions.controller.ts
import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async listMine(@Req() req: any) {
    const userId: string = req.user?.id ?? req.user?.sub;
    // Prismaのモデル名・フィールドはあなたのschemaに合わせて調整
    return this.prisma.subscription.findMany({
      where: { userId },
      select: {
        id: true,
        planId: true,
        status: true,
        currentPeriodStart: true,
        currentPeriodEnd: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
