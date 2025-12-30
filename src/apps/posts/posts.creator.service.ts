// api/src/apps/posts/posts.creator.service.ts

import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MediaType, PostPublishedStatus, Role, PostVisibility } from '@prisma/client';
import { getCreatorByUserIdOrThrow, isAdminRole } from './posts.authz';

@Injectable()
export class PostsCreatorService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 投稿を作成
   * - 運営(admin/sub_admin): 公式投稿のみ & freeのみ
   * - 一般ユーザー: クリエイター登録があれば creator投稿として作れる（必要なら approved 必須に変更可能）
   */
  async createPost(userId: string, dto: any) {
    const { title, body, visibility, planId, priceJpy, media } = dto;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    const isOfficial = isAdminRole(user?.role ?? null);

    // ✅ 運営は無料公式だけ（現行ルール踏襲）
    if (isOfficial && visibility !== PostVisibility.free) {
      throw new ForbiddenException('管理者は無料投稿のみ作成できます');
    }

    // plan投稿なのにplanIdがない → エラー
    if (visibility === PostVisibility.plan && !planId) {
      throw new ForbiddenException('planId が必要です');
    }

    // PPV なのに price がない → エラー
    if (visibility === PostVisibility.paid_single && !priceJpy) {
      throw new ForbiddenException('価格を設定してください');
    }

    // ✅ 公式投稿は creatorId=null
    // ✅ クリエイター投稿は creator.id を入れる（User.role は見ない）
    const creatorId = isOfficial
      ? null
      : (await getCreatorByUserIdOrThrow(this.prisma, userId, { requireApproved: true })).userId;

    const post = await this.prisma.post.create({
      data: {
        creatorId,
        title,
        body,
        visibility,
        planId: planId || null,
        priceJpy: priceJpy || null,
        publishedStatus: PostPublishedStatus.published,
        isOfficial,
      },
    });

    // dto.media がある場合（URLを保存するだけ）
    if (media?.length) {
      await this.prisma.postMedia.createMany({
        data: media.map((m: any, idx: number) => ({
          postId: post.id,
          url: m.url,
          mediaType: m.mediaType as MediaType,
          sortOrder: idx,
          isSample: !!m.isSample,
        })),
      });
    }

    return post;
  }
}
