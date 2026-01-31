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
import { NotificationsService } from '../notifications/notifications.service';
import { AdminAnnouncementsController } from './admin-announcements.controller';
import { AdminAnnouncementsMediaController } from './admin-announcement-media.controller';
import { AuditModule } from '../audit/audit.module';
import { AdminAuditLogsController } from './admin-audit-logs.controller';
import { AdminErrorLogsController } from './admin-error-logs.controller';

@Module({
  imports: [
    StorageModule,
    AuditModule,
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
    AdminAnnouncementsController,
    AdminAnnouncementsMediaController,
    AdminAuditLogsController,
    AdminErrorLogsController,
  ],
  providers: [
    PrismaService,
    AdminService,
    AdminCreatorsService,
    AdminShopsService,
    S3Service,
    PostDeleteService,
    NotificationsService,
  ],
  exports:[
    PostDeleteService,
  ],
})
export class AdminModule {}
