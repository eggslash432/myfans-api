// api/src/apps/error-log/error-log.service.ts

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ErrorLogService {
  constructor(private readonly prisma: PrismaService) {}

  async write(input: {
    level?: string;
    message: string;
    name?: string | null;
    stack?: string | null;
    statusCode?: number | null;
    method?: string | null;
    path?: string | null;
    userId?: string | null;
    role?: any | null; // Role | null （型循環が嫌なら any でOK）
    ip?: string | null;
    userAgent?: string | null;
    meta?: any;
  }) {
    await this.prisma.errorLog.create({
      data: {
        level: input.level ?? 'error',
        message: input.message,
        name: input.name ?? null,
        stack: input.stack ?? null,
        statusCode: input.statusCode ?? null,
        method: input.method ?? null,
        path: input.path ?? null,
        userId: input.userId ?? null,
        role: input.role ?? null,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        meta: input.meta ?? null,
      },
    });
  }
}
