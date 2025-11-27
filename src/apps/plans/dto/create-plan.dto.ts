import { IsNotEmpty, IsString, IsInt, Min, IsOptional, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { BillingIntervalEnum } from 'src/shared/enums';

export class CreatePlanDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @Type(() => Number)
  @IsInt()
  @Min(100) // 最低100円〜
  priceJpy: number;

  @IsOptional()
  @IsEnum(BillingIntervalEnum)
  billingInterval?: BillingIntervalEnum;

  @IsOptional()
  @IsString()
  description?: string;
}
