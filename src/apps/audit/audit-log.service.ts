// api/src/apps/audit/audit-log.service.ts

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type WriteAuditParams = {
  actorId: string;
  actorRole?: string | null;

  action: string;

  target?: string | null;       // 互換（user:xxx）
  targetType?: string | null;   // "User" | "Post" | ...
  targetId?: string | null;     // uuid/numberをStringで

  ip?: string | null;
  userAgent?: string | null;

  meta?: any;
};

@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async write(p: WriteAuditParams) {
    return this.prisma.auditLog.create({
      data: {
        actorId: p.actorId,
        actorRole: p.actorRole ?? null,
        action: p.action,
        target: p.target ?? null,
        targetType: p.targetType ?? null,
        targetId: p.targetId ?? null,
        ip: p.ip ?? null,
        userAgent: p.userAgent ?? null,
        meta: p.meta ?? undefined,
      },
    });
  }
}
