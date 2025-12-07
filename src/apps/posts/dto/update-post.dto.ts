// api/src/apps/posts/dto/update-post.dto.ts
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { PublishedStatus, Visibility } from '@prisma/client';

export class UpdatePostDto {
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
}
