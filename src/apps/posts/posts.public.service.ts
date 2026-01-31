// api/src/apps/posts/posts.public.service.ts

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  PostPublishedStatus,
  SubscriptionStatus,
  PostVisibility,
} from '@prisma/client';

@Injectable()
export class PostsPublicService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * detail: Post + media + creator + genres を返す（Genre[] に正規化）
   */
  async getPostDetail(postId: string, viewerId: string | null) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      include: {
        creator: { select: { publicName: true } },
        media: { orderBy: { sortOrder: 'asc' } },
        genres: { include: { genre: true } }, // ✅ 追加
      },
    });

    if (!post) throw new NotFoundException('投稿が見つかりません');

    let canViewMain = false;

    if (post.visibility === PostVisibility.free) {
      canViewMain = true;
    } else if (viewerId && post.creatorId === viewerId) {
      // creatorId が userId 運用ならこれでOK（あなたの他コードもこの前提）
      canViewMain = true;
    } else if (viewerId && post.visibility === PostVisibility.plan) {
      const activeSub = await this.prisma.subscription.findFirst({
        where: {
          userId: viewerId,
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

    // ✅ Genre[] に正規化
    const genres = post.genres.map((pg) => pg.genre);

    // post.genres(PostGenre[]) は返さない（フロント型に合わせる）
    const { genres: _raw, ...rest } = post as any;

    return {
      ...rest,
      genres,
      canView: canViewMain,
      isLocked: !canViewMain,
      canViewMain,
      canViewSample,
    };
  }

  /**
   * 公開フィード
   */
  async getPublicFeed() {
    const posts = await this.prisma.post.findMany({
      where: { publishedStatus: PostPublishedStatus.published },
      orderBy: { publishedAt: 'desc' },
      include: {
        creator: { select: { publicName: true } },
        media: { orderBy: { sortOrder: 'asc' } },
        genres: { include: { genre: true } }, // ✅ 追加（一覧で使わないなら外してOK）
      },
    });

    // ✅ Genre[] に正規化して返す
    return posts.map((p: any) => {
      const genres = p.genres.map((pg: any) => pg.genre);
      const { genres: _raw, ...rest } = p;
      return { ...rest, genres };
    });
  }

  /**
   * listPublic: 公式だけ/全体 の簡易一覧
   * ※ 返却項目が少なくて良いなら select にしてもOK
   */
  async listPublic({ onlyOfficial }: { onlyOfficial: boolean }) {
    const posts = await this.prisma.post.findMany({
      where: {
        publishedStatus: PostPublishedStatus.published,
        ...(onlyOfficial ? { isOfficial: true } : {}),
      },
      orderBy: { publishedAt: 'desc' },
      take: 20,
      include: {
        creator: { select: { publicName: true } },
        media: { orderBy: { sortOrder: 'asc' } },
        genres: { include: { genre: true } },
      },
    });

    return posts.map((p: any) => {
      const genres = p.genres.map((pg: any) => pg.genre);
      const { genres: _raw, ...rest } = p;
      return { ...rest, genres };
    });
  }

  /**
   * ジャンル別一覧（explicit m2m 対応）
   */
  async listByGenre(genreId: string) {
    const posts = await this.prisma.post.findMany({
      where: {
        publishedStatus: PostPublishedStatus.published,
        visibility: PostVisibility.free,
        genres: {
          some: { genreId }, // ✅ ここが最重要：genreId カラム直参照はもう無い
        },
      },
      orderBy: { publishedAt: 'desc' },
      take: 50,
      include: {
        creator: { select: { publicName: true } },
        media: { orderBy: { sortOrder: 'asc' } },
        genres: { include: { genre: true } },
      },
    });

    return posts.map((p: any) => {
      const genres = p.genres.map((pg: any) => pg.genre);
      const { genres: _raw, ...rest } = p;
      return { ...rest, genres };
    });
  }
}
