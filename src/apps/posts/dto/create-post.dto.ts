// src/apps/posts/dto/create-post.dto.ts
import {
  IsString, IsEnum, IsOptional, IsArray, IsBoolean, IsInt, Min, ValidateNested, ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AgeRating, PublishedStatus, Visibility, MediaType} from '@prisma/client';
import { AgeRatingEnum, PublishedStatusEnum, VisibilityEnum, MediaTypeEnum } from 'src/shared/enums';

class AccessRulesDto {
  @IsArray() @IsOptional()
  allowByPlanIds?: string[] = [];

  @IsBoolean()
  allowByPpv!: boolean;

  @IsInt() @Min(100) @IsOptional()
  ppvPriceJpy?: number; // allowByPpv=true のときに使用
}

export class CreatePostMediaDto {
  @IsEnum(MediaTypeEnum) mediaType!: MediaTypeEnum;

  @IsString()
  url: string;

  @IsInt()
  @IsOptional()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isSample?: boolean;
}

export class CreatePostDto {
  @IsString() title!: string;
  @IsString() body!: string;

  @IsEnum(VisibilityEnum) visibility!: VisibilityEnum;
  @IsEnum(AgeRatingEnum) ageRating!: AgeRatingEnum;

  // visibility=plan のときのみ検証
  @ValidateIf(o => o.visibility === VisibilityEnum.plan)
  @IsString()
  planId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePostMediaDto)
  @IsOptional()
  media?: CreatePostMediaDto[];

  // visibility=paid_single のときのみ検証
  @ValidateIf(o => o.visibility === VisibilityEnum.paid_single)
  @IsInt() @Min(100)
  priceJpy?: number;

  // 受け取ってよい（下書きフラグ）
  @IsEnum(PublishedStatusEnum) @IsOptional()
  publishedStatus?: PublishedStatusEnum;

  @ValidateNested() @Type(() => AccessRulesDto)
  accessRules!: AccessRulesDto;
}
