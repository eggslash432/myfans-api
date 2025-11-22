// src/apps/payments/payouts.admin.controller.ts
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminOnlyGuard } from '../access-control/admin-only.guard';
import { PayoutsService } from './payouts.service';
import { PayoutStatus } from '@prisma/client';

@Controller('admin/payouts')
@UseGuards(JwtAuthGuard, AdminOnlyGuard)
export class AdminPayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  @Get()
  async list(@Query('status') status?: PayoutStatus) {
    return this.payouts.adminListPayouts(status);
  }

  @UseGuards(JwtAuthGuard, AdminOnlyGuard)
  @Post(':id/approve')
  async approve(@Param('id') id: string) {
    return this.payouts.approvePayout(id);
  }

  @Post(':id/reject')
  async reject(
    @Param('id') id: string,
    @Req() req: any,
    @Body() body: { note?: string },
  ) {
    const adminId = req.user.sub as string;
    return this.payouts.adminReject(id, adminId, body.note);
  }
}
