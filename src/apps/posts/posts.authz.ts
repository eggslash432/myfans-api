//api/src/apps/posts/posts.authz.ts

import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export function isAdminRole(role: Role | null | undefined) {
  return role === Role.admin || role === Role.sub_admin;
}

/**
 * 「投稿のcreatorIdは creator.id」を前提にする
 * - 承認必須（approved）にしたい時は requireApproved=true にする
 */
export async function getCreatorByUserIdOrThrow(
  prisma: PrismaService,
  userId: string,
  opts?: { requireApproved?: boolean },
) {
  const creator = await prisma.creator.findUnique({
    where: { userId },
    select: { userId: true, approvalStatus: true },
  });

  if (!creator) throw new ForbiddenException('クリエイター登録が必要です');

  if (opts?.requireApproved && creator.approvalStatus !== 'approved') {
    throw new ForbiddenException('承認済みクリエイターのみ実行できます');
  }

  return creator; // { id, approvalStatus }
}
