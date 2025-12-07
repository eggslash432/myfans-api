// api/src/apps/admin/admin.module.ts

import { Module } from '@nestjs/common';
import { AdminCreatorsController } from './admin-creators.controller';
import { PrismaService } from '../prisma/prisma.service';
import { AdminPostsController } from './admin.posts.controller';
import { AdminReportsController } from './admin-reports.controller';
import { AdminSummaryController } from './admin-summary.controller';
import { AdminService } from './admin.service';

@Module({
  controllers: [
    AdminCreatorsController, 
    AdminCreatorsController, 
    AdminPostsController,
    AdminReportsController,
    AdminSummaryController,
  ],
  providers: [
    PrismaService,
    AdminService,
  ],
})
export class AdminModule {}
