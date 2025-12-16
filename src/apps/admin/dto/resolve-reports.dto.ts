// api/src/apps/admin/dto/resolve-reports.dto.ts

import { IsIn } from 'class-validator';

export class ResolveReportDto {
  @IsIn(['reviewed', 'dismissed'])
  action!: 'reviewed' | 'dismissed';
}