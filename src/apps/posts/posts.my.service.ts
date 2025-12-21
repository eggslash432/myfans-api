// api/src/apps/posts/posts.my.service.ts

import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '@prisma/client';
import { getCreatorByUserIdOrThrow, isAdminRole } from './posts.authz';

@Injectable()
export class PostsMyService {
  constructor(private readonly prisma: PrismaService) {}

  async getMyPosts(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    if (isAdminRole(user?.role ?? null)) {
      return await this.prisma.post.findMany({
        where: { isOfficial: true },
        orderBy: { createdAt: 'desc' },
        include: {
          media: true,
          _count: { select: { postAccesses: true, reports: true } },
        },
      });
    }

    const creator = await getCreatorByUserIdOrThrow(this.prisma, userId, { requireApproved: false });

    return await this.prisma.post.findMany({
      where: { creatorId: creator.userId },
      orderBy: { createdAt: 'desc' },
      include: {
        media: true,
        _count: { select: { postAccesses: true, reports: true } },
      },
    });
  }
}
