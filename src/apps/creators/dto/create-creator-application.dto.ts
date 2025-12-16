// api/src/apps/creators/dto/create-creator-application.dto.ts
import { IsString, IsOptional, IsObject } from 'class-validator';

export class CreateCreatorApplicationDto {
  @IsString()
  shopId: string;

  @IsOptional()
  @IsString()
  publicName?: string;

  @IsOptional()
  @IsObject()
  bankAccount?: Record<string, any>;
}
