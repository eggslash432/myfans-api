// api/src/apps/payments/dto/admin-payouts.query.ts

import { IsDate, IsEnum, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { PayoutStatus, PayoutTargetType } from '@prisma/client';

export class AdminPayoutsQueryDto {
  @IsOptional()
  @IsEnum(PayoutStatus)
  status?: PayoutStatus;

  @IsOptional()
  @IsEnum(PayoutTargetType)
  targetType?: PayoutTargetType;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;

  // sort（許可リスト）
  @IsOptional()
  @IsIn(['requestedAt', 'paidAt', 'amountJpy', 'payoutStatus', 'targetType', 'id'])
  sortBy?: 'requestedAt' | 'paidAt' | 'amountJpy' | 'payoutStatus' | 'targetType' | 'id';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir?: 'asc' | 'desc';

  // pagination
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}
