// api/src/apps/users/me/dto/update-notification-settings.dto.ts
import { IsBoolean, IsOptional } from "class-validator";

export class UpdateNotificationSettingsDto {
  @IsOptional() @IsBoolean()
  inAppEnabled?: boolean;

  @IsOptional() @IsBoolean()
  emailEnabled?: boolean;
}
