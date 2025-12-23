// src/apps/payments/payouts.admin.controller.ts
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
  BadRequestException,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminOnlyGuard } from '../access-control/admin-only.guard';
import { PayoutStatus, PayoutTargetType } from '@prisma/client';
import { PayoutsAdminService } from './payouts-admin.service';

@Controller('admin/payouts')
@UseGuards(JwtAuthGuard, AdminOnlyGuard)
export class AdminPayoutsController {
  constructor(private readonly payoutsAdminService: PayoutsAdminService) {}

  /**
   * 出金申請一覧（CREATOR / SHOP 統合）
   */
  @Get()
  async list(
    @Query('status') status?: PayoutStatus,
    @Query('targetType') targetType?: PayoutTargetType,
  ) {
    return this.payoutsAdminService.adminListPayouts({
      status,
      targetType,
    });
  }

  /**
   * 承認
   */
  @Patch(':id/approve')
  async approve(@Param('id') id: string) {
    return this.payoutsAdminService.adminApprove(id);
  }

  /**
   * 却下
   */
  @Patch(':id/reject')
  async reject(
    @Param('id') id: string,
    @Body() body: { note?: string },
  ) {
    return this.payoutsAdminService.adminReject(id, body.note);
  }

  /**
   * 支払済みにする（振込完了後）
   */
  @Patch(':id/paid')
  async markPaid(@Param('id') id: string) {
    return this.payoutsAdminService.adminMarkPaid(id);
  }

  @Get('csv')
  async exportCsv(
    @Res() res: Response,
    @Query('month') month?: string, // 例: 2025-01
  ) {
    const csv = await this.payoutsAdminService.exportPayoutCsv(month);

    const filename = month
      ? `payouts_${month}.csv`
      : `payouts_all.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );

    res.send('\uFEFF' + csv); // ★ Excel 文字化け防止（BOM）
  }  
}
