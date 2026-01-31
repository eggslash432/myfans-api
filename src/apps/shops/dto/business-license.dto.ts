// api/src/apps/shops/dto/business-license.dto.ts

import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RejectBusinessLicenseDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
