// api/src/apps/admin/dto/admin-list.dto.ts
import { IsOptional, IsString } from 'class-validator';

export class AdminListQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  take?: string; // queryなので string で受けて parse する

  @IsOptional()
  @IsString()
  cursor?: string; // idをcursorにする
}
