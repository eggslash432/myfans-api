// api/src/apps/admin/dto/admin-upsert-shop-member.dto.ts
import { IsIn, IsString } from 'class-validator';

export class AdminUpsertShopMemberDto {
  @IsString()
  userId!: string;

  @IsIn(['owner', 'admin', 'staff'])
  role!: 'owner' | 'admin' | 'staff';
}
