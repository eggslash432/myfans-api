// api/src/apps/error-log/error-log.module.ts

import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ErrorLogService } from './error-log.service';

@Module({
  providers: [PrismaService, ErrorLogService],
  exports: [ErrorLogService],
})
export class ErrorLogModule {}
