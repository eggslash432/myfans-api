// api/src/apps/posts/posts.public.service.ts

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PostPublishedStatus, SubscriptionStatus, PostVisibility } from '@prisma/client';

@Injectable()
export class PostsPublicService {
  constructor(private readonly prisma: PrismaService) {}

  async getPostDetail(postId: string, viewerId: string | null) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      include: {
        creator: true,
        media: true,
      },
    });

    if (!post) throw new NotFoundException('投稿が見つかりません');

    let canViewMain = false;

    if (post.visibility === PostVisibility.free) {
      canViewMain = true;
    } else if (viewerId && post.creatorId === viewerId) {
      // ⚠️ここは post.creatorId が creator.id の場合ズレるので注意
      // 「投稿者本人常に閲覧可」にしたいなら viewerId から creatorId を引いて比較する必要あり
      canViewMain = true;
    } else if (viewerId && post.visibility === PostVisibility.plan) {
      const activeSub = await this.prisma.subscription.findFirst({
        where: {
          userId: viewerId ?? undefined,
          creatorId: post.creatorId ?? undefined,
          status: SubscriptionStatus.active,
          currentPeriodEnd: { gt: new Date() },
        },
      });
      if (activeSub) canViewMain = true;
    } else if (viewerId && post.visibility === PostVisibility.paid_single) {
      const access = await this.prisma.postAccess.findUnique({
        where: { userId_postId: { userId: viewerId, postId } },
      });
      if (access && (!access.expiresAt || access.expiresAt > new Date())) {
        canViewMain = true;
      }
    }

    const hasSampleMedia = post.media.some((m) => m.isSample === true);
    const canViewSample = hasSampleMedia;

    return {
      ...post,
      canView: canViewMain,
      isLocked: !canViewMain,
      canViewMain,
      canViewSample,
    };
  }

  async getPublicFeed() {
    return await this.prisma.post.findMany({
      where: { publishedStatus: PostPublishedStatus.published },
      orderBy: { publishedAt: 'desc' },
      include: {
        creator: { select: { publicName: true } },
        media: true,
      },
    });
  }

  async listPublic({ onlyOfficial }: { onlyOfficial: boolean }) {
    return this.prisma.post.findMany({
      where: {
        publishedStatus: 'published',
        ...(onlyOfficial ? { isOfficial: true } : {}),
      },
      orderBy: { publishedAt: 'desc' },
      take: 20,
    });
  }

  async listByGenre(genreId: string) {
    return this.prisma.post.findMany({
      where: {
        genreId,
        publishedStatus: 'published',
        visibility: PostVisibility.free,
      },
      orderBy: { publishedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        title: true,
        body: true,
        publishedAt: true,
        createdAt: true,
        priceJpy: true,
        creatorId: true,
        genreId: true,
      },
    });
  }
}
