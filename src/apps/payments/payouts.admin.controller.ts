// api/src/apps/payments/payouts.admin.controller.ts

import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminOnlyGuard } from '../access-control/admin-only.guard';
import { PayoutsAdminService } from './payouts-admin.service';
import { AdminPayoutsQueryDto } from './dto/admin-payouts.query';

@Controller('admin/payouts')
@UseGuards(JwtAuthGuard, AdminOnlyGuard)
export class AdminPayoutsController {
  constructor(private readonly payoutsAdminService: PayoutsAdminService) {}

  /**
   * 出金申請一覧（CREATOR / SHOP 統合）
   * 例:
   *  /admin/payouts?status=requested&targetType=CREATOR&sortBy=requestedAt&sortDir=desc&page=1&pageSize=50
   */
  @Get()
  async list(@Query() q: AdminPayoutsQueryDto) {
    // ✅ ここは DTO + ValidationPipe で enum/許可リストを保証する設計
    return this.payoutsAdminService.adminListPayouts(q);
  }

  /**
   * 承認（現状 requested -> paid）
   */
  @Patch(':id/approve')
  async approve(@Param('id') id: string) {
    return this.payoutsAdminService.adminApprove(id);
  }

  /**
   * 却下
   */
  @Patch(':id/reject')
  async reject(@Param('id') id: string, @Body() body: { note?: string }) {
    return this.payoutsAdminService.adminReject(id, body.note);
  }

  /**
   * 支払済みにする（approved -> paid）
   * ✅ note を渡せるようにしておくと運用がラク
   */
  @Patch(':id/paid')
  async markPaid(
    @Param('id') id: string,
    @Body() body: { note?: string },
  ) {
    return this.payoutsAdminService.adminMarkPaid(id, body.note);
  }

  /**
   * CSV エクスポート
   * month: 例 "2025-01"
   */
  @Get('csv')
  async exportCsv(
    @Res() res: Response,
    @Query('month') month?: string,
  ) {
    const csv = await this.payoutsAdminService.exportPayoutCsv(month);

    const filename = month ? `payouts_${month}.csv` : `payouts_all.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );

    // ★ Excel 文字化け防止（BOM）
    res.send('\uFEFF' + csv);
  }
}
