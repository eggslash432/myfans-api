// api/src/apps/admin/admin.module.ts

import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AdminPostsController } from './admin.posts.controller';
import { AdminReportsController } from './admin-reports.controller';
import { AdminSummaryController } from './admin-summary.controller';
import { AdminService } from './admin.service';
import { AdminSettingsController } from './admin-settings.controller';
import { AdminUsersController } from './admin-users.controller';
import { S3Service } from '../storage/s3.service';
import { PostDeleteService } from '../posts/post-delete.service';
import { StorageModule } from '../storage/storage.module';
import { AdminShopsController } from './admin-shops.controller';
import { AdminCreatorsController } from './creators/admin-creators.controller';
import { AdminCreatorsService } from './creators/admin-creators.service';
import { AdminShopsService } from './admin-shops.service';
import { AdminNotificationsController } from './admin-notifications.controller';

@Module({
  imports: [
    StorageModule,
  ],
  controllers: [
    AdminCreatorsController, 
    AdminPostsController,
    AdminReportsController,
    AdminSummaryController,
    AdminSettingsController,
    AdminUsersController,
    AdminShopsController,
    AdminNotificationsController,
  ],
  providers: [
    PrismaService,
    AdminService,
    AdminCreatorsService,
    AdminShopsService,
    S3Service,
    PostDeleteService,
  ],
  exports:[
    PostDeleteService,
  ],
})
export class AdminModule {}
