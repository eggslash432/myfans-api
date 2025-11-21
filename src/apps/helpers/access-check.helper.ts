// src/apps/helpers/access-check.helper.ts

import { ForbiddenException, Injectable } from '@nestjs/common';
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
   * @returns { post, canView }
   */
  async assertCanViewPost(userId: string | null, postId: string) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      include: {
        plan: true,
        creator: true,
      },
    });

    if (!post) {
      throw new ForbiddenException('投稿が存在しません');
    }

    // ✦ 非公開・下書きはクリエイター本人のみ
    if (post.publishedStatus !== PublishedStatus.published) {
      if (!userId || post.creatorId !== userId) {
        throw new ForbiddenException('この投稿は公開されていません');
      }
      return { post, canView: true };
    }

    // ✦ 無料投稿
    if (post.visibility === Visibility.free) {
      return { post, canView: true };
    }

    // ✦ ここより下はログイン必須
    if (!userId) {
      throw new ForbiddenException('ログインが必要です');
    }

    // ✦ プラン限定の投稿
    if (post.visibility === Visibility.plan) {
      if (!post.planId) {
        throw new ForbiddenException('この投稿にはプラン設定がありません');
      }

      const sub = await this.prisma.subscription.findFirst({
        where: {
          userId,
          planId: post.planId,
          status: {
            in: [SubStatus.active, SubStatus.trialing],
          },
          currentPeriodEnd: { gt: new Date() },
        },
      });

      if (!sub) {
        throw new ForbiddenException('この投稿はプラン加入者限定です');
      }

      return { post, canView: true };
    }

    // ✦ PPV（単品課金）
    if (post.visibility === Visibility.paid_single) {
      const access = await this.prisma.postAccess.findUnique({
        where: {
          userId_postId: {
            userId,
            postId: post.id,
          },
        },
      });

      if (!access || (access.expiresAt && access.expiresAt <= new Date())) {
        throw new ForbiddenException('この投稿を閲覧する権限がありません');
      }

      return { post, canView: true };
    }

    throw new ForbiddenException('この投稿は閲覧できません');
  }
}
