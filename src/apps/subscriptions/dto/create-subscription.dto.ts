import { IsInt } from 'class-validator';

export class CreateSubscriptionDto {
  @IsInt()
  planId: number;
}
