import { BillingInterval } from '@prisma/client';
import { IsNotEmpty, IsString, IsInt, Min, IsOptional, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePlanDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @Type(() => Number)
  @IsInt()
  @Min(100) // 最低100円〜
  priceJpy: number;

  @IsOptional()
  @IsEnum(BillingInterval)
  billingInterval?: BillingInterval;

  @IsOptional()
  @IsString()
  description?: string;
}
