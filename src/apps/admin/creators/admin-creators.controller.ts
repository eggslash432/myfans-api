// api/src/apps/admin/creators/admin-creators.controller.ts

import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AdminOnlyGuard } from '../../access-control/admin-only.guard';
import { CreatorApprovalStatus } from '@prisma/client';
import { AdminCreatorsService } from './admin-creators.service';
import { UpdateListingDto } from './dto/update-listing.dto';
import { RejectApplicationDto } from './dto/reject-application.dto';

@UseGuards(JwtAuthGuard, AdminOnlyGuard)
@Controller('admin/creators')
export class AdminCreatorsController {
  constructor(private readonly svc: AdminCreatorsService) {}

  @Get('applications')
  listApplications(
    @Query('status') status?: CreatorApprovalStatus,
    @Query('q') q?: string,
  ) {
    return this.svc.listApplications({ status, q });
  }

  @Patch('applications/:userId/approve')
  approve(@Param('userId') userId: string) {
    return this.svc.approve(userId);
  }

  @Patch('applications/:userId/reject')
  reject(
    @Param('userId') userId: string,
    @Body() body: RejectApplicationDto,
  ) {
    return this.svc.reject(userId, body.reason);
  }

  @Get()
  listCreators(
    @Query('isListed') isListed?: string,
    @Query('kycStatus') kycStatus?: string,
    @Query('approvalStatus') approvalStatus?: string,
  ) {
    return this.svc.listCreators({ isListed, kycStatus, approvalStatus });
  }

  @Get(':userId')
  getCreator(@Param('userId') userId: string) {
    return this.svc.getCreator(userId);
  }

  @Patch(':userId/listing')
  updateListing(
    @Param('userId') userId: string,
    @Body() body: UpdateListingDto,
  ) {
    return this.svc.updateListing(userId, body.isListed);
  }

  @Get('applications/:userId/history')
  getApplicationHistory(@Param('userId') userId: string) {
    return this.svc.getApplicationHistory(userId);
  }
}
