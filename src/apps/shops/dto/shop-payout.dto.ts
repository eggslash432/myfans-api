// api/src/apps/shops/dto/shop-payout.dto.ts
import { IsInt, Min, IsOptional, IsString } from 'class-validator'

export class CreateShopPayoutDto {
  @IsInt()
  @Min(1)
  amountJpy: number

  @IsOptional()
  @IsString()
  note?: string
}