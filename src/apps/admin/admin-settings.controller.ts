// api/src/apps/admin/admin-settings.controller.ts
import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminOnlyGuard } from '../access-control/admin-only.guard';

@Controller('admin/settings')
@UseGuards(JwtAuthGuard, AdminOnlyGuard)
export class AdminSettingsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('fees')
  async getFees() {
    const setting =
      (await this.prisma.feeSetting.findFirst()) ??
      (await this.prisma.feeSetting.create({
        data: { managerPercent: 20, shopPercent: 10, creatorPercent: 70 },
      }));

    return setting;
  }

  @Patch('fees')
  async updateFees(
    @Body()
    body: {
      managerPercent: number;
      shopPercent: number;
      creatorPercent: number;
    },
  ) {
    const total =
      body.managerPercent + body.shopPercent + body.creatorPercent;
    if (total !== 100) {
      throw new Error('合計が 100% になるように設定してください');
    }

    const setting = await this.prisma.feeSetting.upsert({
      where: { id: 1 },
      update: body,
      create: { id: 1, ...body },
    });

    return setting;
  }
}
