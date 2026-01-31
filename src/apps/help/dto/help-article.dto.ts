// api/src/apps/help/dto/help-article.dto.ts

import { HelpCategory } from '@prisma/client';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateHelpArticleDto {
  @IsString()
  @MaxLength(200)
  slug!: string;

  @IsString()
  @MaxLength(200)
  title!: string;

  @IsString()
  body!: string;

  @IsOptional()
  @IsEnum(HelpCategory)
  category: HelpCategory; // 必須にする

  @IsOptional()
  @IsInt()
  order?: number;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}

export class UpdateHelpArticleDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  body?: string;

  @IsOptional()
  @IsEnum(HelpCategory)
  category?: HelpCategory;

  @IsOptional()
  @IsInt()
  order?: number;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}
