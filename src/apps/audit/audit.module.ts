// api/src/apps/audit/audit.module.ts
import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from './audit-log.service';

@Module({
  providers: [PrismaService, AuditLogService],
  exports: [AuditLogService],
})
export class AuditModule {}
