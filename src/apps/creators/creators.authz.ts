// api/src/apps/creators/creators.authz.ts

import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export function isAdminRole(role: Role | null | undefined) {
  return role === Role.admin || role === Role.sub_admin;
}

export async function getCreatorByUserId(prisma: PrismaService, userId: string) {
  return prisma.creator.findUnique({
    where: { userId },
    select: { userId: true, approvalStatus: true },
  });
}

export async function requireCreatorApproved(prisma: PrismaService, userId: string) {
  const creator = await getCreatorByUserId(prisma, userId);
  if (!creator) throw new ForbiddenException('クリエイター登録が必要です');
  if (creator.approvalStatus !== 'approved') {
    throw new ForbiddenException('承認済みクリエイターのみ実行できます');
  }
  return creator;
}
