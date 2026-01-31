// api/src/apps/users/me/me-notification-settings.controller.ts
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Req,
  UseGuards,
  BadRequestException,
} from "@nestjs/common";
import { MeNotificationSettingsService } from "./me-notification-settings.service";
import { UpdateNotificationSettingsDto } from "./dto/update-notification-settings.dto";
import { NotificationType } from "@prisma/client";
import { AuthGuard } from "@nestjs/passport";

@Controller("me/notification-settings")
@UseGuards(AuthGuard("jwt")) // ✅ ここがポイント
export class MeNotificationSettingsController {
  constructor(private service: MeNotificationSettingsService) {}

  @Get()
  async list(@Req() req: any) {
    return this.service.list(req.user.id);
  }

  @Patch(":type") // ✅ PATCHに合わせる
  async updateOne(
    @Req() req: any,
    @Param("type") typeRaw: string,
    @Body() dto: UpdateNotificationSettingsDto,
  ) {
    const type = (NotificationType as any)[typeRaw];
    if (!type) throw new BadRequestException("invalid notification type");

    return this.service.updateOne(req.user.id, type as NotificationType, dto);
  }
}
