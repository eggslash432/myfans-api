// src/apps/posts/dto/create-post.dto.ts
import {
  IsString, IsEnum, IsOptional, IsArray, IsBoolean, IsInt, Min, ValidateNested, ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AgeRating, Status, Visibility } from 'src/common/enums/post.enums';

class AccessRulesDto {
  @IsArray() @IsOptional()
  allowByPlanIds?: string[] = [];

  @IsBoolean()
  allowByPpv!: boolean;

  @IsInt() @Min(100) @IsOptional()
  ppvPriceJpy?: number; // allowByPpv=true のときに使用
}

export class CreatePostDto {
  @IsString() title!: string;
  @IsString() body!: string;

  @IsEnum(Visibility) visibility!: Visibility;
  @IsEnum(AgeRating) ageRating!: AgeRating;

  // visibility=plan のときのみ検証
  @ValidateIf(o => o.visibility === Visibility.plan)
  @IsString()
  planId?: string;

  // visibility=paid_single のときのみ検証
  @ValidateIf(o => o.visibility === Visibility.paid_single)
  @IsInt() @Min(100)
  priceJpy?: number;

  // 受け取ってよい（下書きフラグ）
  @IsEnum(Status) @IsOptional()
  status?: Status;

  @ValidateNested() @Type(() => AccessRulesDto)
  accessRules!: AccessRulesDto;
}
