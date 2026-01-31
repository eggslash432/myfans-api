// api/src/apps/users/me/me.module.ts
import { Module } from "@nestjs/common";
import { PrismaService } from "src/apps/prisma/prisma.service";
import { MeNotificationSettingsController } from "./me-notification-settings.controller";
import { MeNotificationSettingsService } from "./me-notification-settings.service";
import { MeNotificationsController } from "./me-notifications.controller";

@Module({
  controllers: [
    MeNotificationsController,
    MeNotificationSettingsController,
  ],
  providers: [
    PrismaService,
    MeNotificationSettingsService,
  ],
  exports: [
    MeNotificationSettingsService,
  ],
})
export class MeModule {}
