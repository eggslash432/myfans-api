// api/src/apps/admin/creators/dto/update-listing.dto.ts

import { IsBoolean } from 'class-validator';

export class UpdateListingDto {
  @IsBoolean()
  isListed!: boolean;
}
