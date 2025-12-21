// api/src/apps/admin/creators/dto/reject-application.dto.ts

import { IsString } from 'class-validator';

export class RejectApplicationDto {
  @IsString()
  reason!: string;
}
