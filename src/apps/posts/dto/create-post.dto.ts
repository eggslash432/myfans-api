// src/apps/posts/dto/create-post.dto.ts
import { IsString, IsEnum, IsOptional, IsArray, IsBoolean, IsInt, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export enum Visibility { free = 'free', paid = 'paid' }
export enum AgeRating { all = 'all', r18 = 'r18' }

class AccessRulesDto {
  @IsArray() @IsOptional()
  allowByPlanIds?: string[] = [];

  @IsBoolean()
  allowByPpv!: boolean;

  @IsInt() @Min(100) @IsOptional()
  ppvPriceJpy?: number; // allowByPpv=trueなら必須にしたければカスタムバリデータで
}

export class CreatePostDto {
  @IsString() title!: string;
  @IsString() body!: string;

  @IsEnum(Visibility) visibility!: Visibility;
  @IsEnum(AgeRating) ageRating!: AgeRating;

  @ValidateNested() @Type(() => AccessRulesDto)
  accessRules!: AccessRulesDto;
}
