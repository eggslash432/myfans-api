import { IsNotEmpty, IsString, IsInt, Min, IsOptional } from 'class-validator';

export class CreatePlanDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsInt()
  @Min(100) // 最低100円〜
  priceJpy: number;

  @IsOptional()
  @IsString()
  description?: string;
}
