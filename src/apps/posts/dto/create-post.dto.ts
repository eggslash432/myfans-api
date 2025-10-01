import { IsNotEmpty, IsOptional, IsString, IsEnum } from 'class-validator';
import { Visibility } from '@prisma/client';

export class CreatePostDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsOptional()
  @IsString()
  bodyMd?: string;

  @IsEnum(Visibility)
  visibility: Visibility;

  @IsOptional()
  @IsString()
  planId?: string;
}
