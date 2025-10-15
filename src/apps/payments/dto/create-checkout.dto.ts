// src/apps/payments/dto/create-checkout.dto.ts
import {
  IsOptional,
  IsUUID,
  IsUrl,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';

@ValidatorConstraint({ name: 'PlanOrPostProvided', async: false })
class PlanOrPostProvided implements ValidatorConstraintInterface {
  validate(_: any, args: ValidationArguments) {
    const o = args.object as any;
    // 少なくともどちらか一方が存在する
    return !!o.planId || !!o.postId;
  }
  defaultMessage() {
    return 'planId か postId のいずれか一方は必須です。';
  }
}

export class CreateCheckoutDto {
  @IsOptional()
  @IsUUID()
  planId?: string;      // サブスク用

  @IsOptional()
  @IsUUID()
  postId?: string;      // PPV用

  @IsUrl()
  successUrl!: string;

  @IsUrl()
  cancelUrl!: string;
}

// クラス全体に「どちらか必須」を適用
export class CreateCheckoutValidatedDto extends CreateCheckoutDto {
  @Validate(PlanOrPostProvided)
  private _eitherPlanOrPost!: string; // ダミープロパティ（実値は使わない）
}
