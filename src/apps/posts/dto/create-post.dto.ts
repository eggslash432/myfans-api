// src/apps/posts/dto/create-post.dto.ts
import {
  IsString, IsEnum, IsOptional, IsArray, IsBoolean, IsInt, Min,
  ValidateNested, ValidateIf,
  ValidationOptions, registerDecorator,
  ArrayUnique,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AgeRatingEnum, PublishedStatusEnum, VisibilityEnum, MediaTypeEnum } from 'src/shared/enums';

class AccessRulesDto {
  @IsArray()
  @IsOptional()
  allowByPlanIds?: string[] = [];

  @IsOptional()
  @IsBoolean()
  allowByPpv?: boolean = false;

  @IsInt()
  @Min(100)
  @IsOptional()
  ppvPriceJpy?: number;
}

export class CreatePostMediaDto {
  @IsEnum(MediaTypeEnum)
  mediaType!: MediaTypeEnum;

  @IsString()
  url!: string;

  @IsInt()
  @IsOptional()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isSample?: boolean;
}

function HasAtMostOneSample(validationOptions?: ValidationOptions) {
  return function (object: any, propertyName: string) {
    registerDecorator({
      name: 'hasAtMostOneSample',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: any) {
          if (!Array.isArray(value)) return true;
          const n = value.filter((v) => v?.isSample === true).length;
          return n <= 1;
        },
      },
    });
  };
}

export class CreatePostDto {
  @IsString()
  title!: string;

  @IsString()
  body!: string;

  @IsEnum(VisibilityEnum)
  visibility!: VisibilityEnum;

  @IsEnum(AgeRatingEnum)
  ageRating!: AgeRatingEnum;

  @ValidateIf((o) => o.visibility === VisibilityEnum.plan)
  @IsString()
  planId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePostMediaDto)
  @HasAtMostOneSample({ message: 'サンプルは1つまで選択できます' })
  media?: CreatePostMediaDto[];

  @ValidateIf((o) => o.visibility === VisibilityEnum.paid_single)
  @IsInt()
  @Min(100)
  priceJpy?: number;

  @IsEnum(PublishedStatusEnum)
  @IsOptional()
  publishedStatus?: PublishedStatusEnum;

  @IsOptional()
  @ValidateNested()
  @Type(() => AccessRulesDto)
  accessRules?: AccessRulesDto;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  genreIds?: string[];  
}
