// api/src/apps/posts/dto/update-post.dto.ts
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  IsArray,
  ValidateNested,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PublishedStatus, Visibility, MediaType } from '@prisma/client';

/**
 * メディア更新用 DTO
 * - id: 既存メディアを更新する場合だけ必要
 * - isSample: このメディアをサンプルにするか？
 */
export class UpdatePostMediaDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsOptional()
  @IsString()
  url?: string;

  @IsOptional()
  @IsEnum(MediaType)
  mediaType?: MediaType;

  @IsOptional()
  @IsBoolean()
  isSample?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  // ✅ 追加
  @IsOptional()
  @IsString()
  genreId?: string;  
}

/**
 * 投稿更新 DTO（旧版に media を追加）
 */
export class UpdatePostDto {
  @IsOptional()
  @IsString()
  planId?: string | null;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  body?: string;

  @IsOptional()
  @IsEnum(Visibility)
  visibility?: Visibility;

  @IsOptional()
  @IsInt()
  @Min(0)
  priceJpy?: number | null;

  @IsOptional()
  @IsEnum(PublishedStatus)
  publishedStatus?: PublishedStatus;

  // ★ 追加：メディア編集用
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdatePostMediaDto)
  media?: UpdatePostMediaDto[];
}
