import { IsString, IsOptional, IsObject } from 'class-validator';

export class CreateCreatorDto {
  // UI側は displayName を送ってくるかもしれないので両方受ける
  @IsOptional()
  @IsString()
  publicName?: string;

  @IsOptional()
  @IsString()
  displayName?: string; // 受け取ったら Profile.displayName に反映

  @IsOptional()
  @IsString()
  bio?: string;         // Profile.bio に反映（Profileモデルに既に存在）

  @IsOptional()
  @IsObject()
  bankAccount?: Record<string, any>;

  // KYC は Creator ではなく KycSubmission に保存
  @IsOptional()
  @IsObject()
  kycDocuments?: Record<string, any>;
}
