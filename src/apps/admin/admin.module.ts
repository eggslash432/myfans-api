// api/src/apps/admin/admin.module.ts

import { Module } from '@nestjs/common';
import { AdminCreatorsController } from './admin-creators.controller';
import { PrismaService } from '../prisma/prisma.service';
import { AdminPostsController } from './admin.posts.controller';
import { AdminReportsController } from './admin-reports.controller';
import { AdminSummaryController } from './admin-summary.controller';
import { AdminService } from './admin.service';
import { AdminSettingsController } from './admin-settings.controller';
import { AdminUsersController } from './admin-users.controller';

@Module({
  controllers: [
    AdminCreatorsController, 
    AdminPostsController,
    AdminReportsController,
    AdminSummaryController,
    AdminSettingsController,
    AdminUsersController,
  ],
  providers: [
    PrismaService,
    AdminService,
  ],
})
export class AdminModule {}
