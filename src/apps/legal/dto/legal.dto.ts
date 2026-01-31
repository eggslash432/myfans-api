// api/src/apps/legal/dto/legal.dto.ts

import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export enum LegalDocumentTypeDto {
  terms = 'terms',
  privacy = 'privacy',
  guideline = 'guideline',
  other = 'other',
}

export class AgreeLegalDto {
  @IsEnum(LegalDocumentTypeDto)
  type!: LegalDocumentTypeDto;

  // クライアントは latest を取得して version を渡す（改ざん防止のためサーバでも検証）
  @IsOptional()
  version?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  userAgent?: string;
}
