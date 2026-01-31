// api/src/apps/posts/posts.creator.service.ts

import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  MediaType,
  PostPublishedStatus,
  PostVisibility,
} from '@prisma/client';
import { getCreatorByUserIdOrThrow, isAdminRole } from './posts.authz';

@Injectable()
export class PostsCreatorService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 投稿を作成
   * - 運営(admin/sub_admin): 公式投稿のみ & freeのみ
   * - 一般ユーザー: クリエイター登録があれば creator投稿として作れる（approved必須）
   */
  async createPost(userId: string, dto: any) {
    const {
      title,
      body,
      visibility,
      planId,
      priceJpy,
      media,
      genreIds, // ✅ 追加
    } = dto;

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
    // ✅ クリエイター投稿は creator.userId を入れる（User.role は見ない）
    const creatorId = isOfficial
      ? null
      : (await getCreatorByUserIdOrThrow(this.prisma, userId, { requireApproved: true })).userId;

    // ✅ genreIds 正規化（未指定なら undefined / 指定なら配列）
    const gids: string[] | undefined =
      Array.isArray(genreIds) ? genreIds.filter((x) => typeof x === 'string' && x.trim()) : undefined;

    // ✅ ジャンル存在チェック（任意だけど推奨）
    if (gids && gids.length > 0) {
      const found = await this.prisma.genre.findMany({
        where: { id: { in: gids }, isActive: true },
        select: { id: true },
      });
      const foundSet = new Set(found.map((g) => g.id));
      const missing = gids.filter((id) => !foundSet.has(id));
      if (missing.length) {
        throw new BadRequestException(`存在しない（または無効な）genreId があります: ${missing.join(', ')}`);
      }
    }

    // ✅ Post作成 + media + genres を transaction でまとめる
    const post = await this.prisma.$transaction(async (tx) => {
      const created = await tx.post.create({
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

      // media（URL保存だけ）
      if (media?.length) {
        await tx.postMedia.createMany({
          data: media.map((m: any, idx: number) => ({
            postId: created.id,
            url: m.url,
            mediaType: m.mediaType as MediaType,
            sortOrder: idx,
            isSample: !!m.isSample,
          })),
        });
      }

      // ✅ genres（explicit m2m）
      if (gids && gids.length > 0) {
        await tx.postGenre.createMany({
          data: gids.map((genreId) => ({
            postId: created.id,
            genreId,
          })),
          skipDuplicates: true,
        });
      }

      return created;
    });

    return post;
  }
}
