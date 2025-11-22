// src/apps/helpers/access-check.helper.ts

import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  PublishedStatus,
  Visibility,
  SubStatus,
} from '@prisma/client';

@Injectable()
export class AccessCheckHelper {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 投稿閲覧権限チェック
   *
   * - free          : 誰でも閲覧可
   * - plan          : 対象プランにアクティブ購読があるユーザーのみ閲覧可
   * - paid_single   : PPV購入(PostAccessあり)ユーザーのみ閲覧可
   *
   * - 投稿者本人は下書き/非公開含めて常に閲覧可
   * - 上記を満たさない場合は ForbiddenException を投げる
   */
  async assertCanViewPost(
    userId: string | null,
    postId: string,
  ): Promise<{ post: any; canView: boolean }> {
    const now = new Date();

    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      include: {
        creator: true,
        plan: true,
        media: true,
      },
    });

    if (!post) {
      throw new NotFoundException('投稿が見つかりません');
    }

    // 投稿者本人はステータス/公開範囲に関係なく閲覧可
    if (userId && post.creatorId === userId) {
      return { post, canView: true };
    }

    // 公開状態チェック（公開されていない投稿は本人以外見せない）
    if (post.publishedStatus !== PublishedStatus.published) {
      throw new ForbiddenException('この投稿は公開されていません');
    }

    // 無料投稿は誰でも閲覧可
    if (post.visibility === Visibility.free) {
      return { post, canView: true };
    }

    // ここから先はログイン必須
    if (!userId) {
      throw new ForbiddenException('この投稿を閲覧する権限がありません');
    }

    // ------ プラン購読者向け投稿 (plan) ------
    if (post.visibility === Visibility.plan) {
      if (!post.planId) {
        // 設計上ありえないが保険
        throw new ForbiddenException('この投稿を閲覧する権限がありません');
      }

      const sub = await this.prisma.subscription.findFirst({
        where: {
          userId,
          creatorId: post.creatorId,
          planId: post.planId,
          status: SubStatus.active,
          currentPeriodStart: { lte: now },
          currentPeriodEnd: { gte: now },
        },
      });

      if (!sub) {
        throw new ForbiddenException('この投稿を閲覧する権限がありません');
      }

      return { post, canView: true };
    }

    // ------ PPV (単品販売) 投稿 (paid_single) ------
    if (post.visibility === Visibility.paid_single) {
      const access = await this.prisma.postAccess.findUnique({
        where: {
          userId_postId: {
            userId,
            postId: post.id,
          },
        },
      });

      if (!access || (access.expiresAt && access.expiresAt <= now)) {
        throw new ForbiddenException('この投稿を閲覧する権限がありません');
      }

      return { post, canView: true };
    }

    // ここまででマッチしなければ閲覧不可
    throw new ForbiddenException('この投稿を閲覧する権限がありません');
  }
}
