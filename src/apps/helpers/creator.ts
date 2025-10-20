// helpers/creator.ts（任意の場所に）
import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export async function getMyCreatorId(prisma: PrismaService, userId: string) {
  const c = await prisma.creator.findUnique({
    where: { userId: String(userId) },
    select: { userId: true },
  });
  if (!c) throw new ForbiddenException('Creator only');
  return c.userId;
}