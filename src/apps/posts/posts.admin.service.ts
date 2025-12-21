// api/src/apps/posts/posts.admin.service.ts

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PublishedStatus } from '@prisma/client';

@Injectable()
export class PostsAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async getAdminPosts(limit = 5) {
    return await this.prisma.post.findMany({
      where: {
        publishedStatus: PublishedStatus.published,
        isOfficial: true,
      },
      orderBy: { publishedAt: 'desc' },
      take: limit,
      include: { media: true },
    });
  }
}
