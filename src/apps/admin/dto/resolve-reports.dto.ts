// api/src/apps/admin/dto/resolve-reports.dto.ts

import { IsEnum } from 'class-validator';
import { ReportStatus } from '@prisma/client';

export class ResolveReportDto {
  @IsEnum(ReportStatus)
  action!: ReportStatus;
}