// api/src/apps/creators/dto/update-creator-profile.dto.ts

import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateCreatorProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  publicName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  bio?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  avatarUrl?: string;
}
