// api/src/apps/admin/admin-reports.service.ts
import { Prisma, ReportStatus } from '@prisma/client';

function parseDateOrUndefined(s?: string) {
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function buildReportQuery(q: {
  status?: ReportStatus;
  q?: string;
  userId?: string;
  postId?: string;
  createdAtFrom?: string;
  createdAtTo?: string;
  sortBy?: 'createdAt' | 'status' | 'id';
  sortDir?: 'asc' | 'desc';
}) {
  const where: Prisma.ReportWhereInput = {};

  if (q.status) where.status = q.status; // ✅ enum
  if (q.userId) where.userId = q.userId;
  if (q.postId) where.postId = q.postId;

  const from = parseDateOrUndefined(q.createdAtFrom);
  const to = parseDateOrUndefined(q.createdAtTo);
  if (from || to) {
    where.createdAt = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    };
  }

  if (q.q) {
    where.reason = { contains: q.q, mode: 'insensitive' };
  }

  const sortBy = q.sortBy ?? 'createdAt';
  const sortDir = q.sortDir ?? 'desc';

  // ✅ orderByは許可リスト経由のみ
  const orderBy: Prisma.ReportOrderByWithRelationInput[] = [
    { [sortBy]: sortDir },
    { id: 'desc' }, // 安定ソート（ページングのズレ防止）
  ];

  return { where, orderBy };
}
