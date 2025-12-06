// api/src/apps/helpers/access-check.helper.ts

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
  Role,
} from '@prisma/client';

@Injectable()
export class AccessCheckHelper {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 閲覧可能かどうかを判定
   * - free → 誰でもOK
   * - 自分の投稿 → OK
   * - plan → 購読中か？
   * - paid_single → 購入済みか？
   */
  async assertCanViewPost(viewerId: string | null, postId: string) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      include: { creator: true },
    });

    if (!post) throw new NotFoundException('投稿が見つかりません');

    /** 1. free は誰でも読める */
    if (post.visibility === Visibility.free) {
      return { post, canView: true };
    }

    /** 2. 未ログインはここから先は読めない */
    if (!viewerId) {
      throw new ForbiddenException('ログインが必要です');
    }

    /** 3. 自分の投稿は必ず読める */
    if (post.creatorId === viewerId) {
      return { post, canView: true };
    }

    /** 4. プラン投稿 → 購読中かチェック */
    if (post.visibility === Visibility.plan) {

      if (!post.creatorId) {
        throw new ForbiddenException('この投稿はクリエイターに紐づいていません');
      }

      const activeSub = await this.prisma.subscription.findFirst({
        where: {
          userId: viewerId,
          creatorId: post.creatorId as string,  // ← null じゃないと確定させる
          status: 'active',
          currentPeriodEnd: { gt: new Date() },
        },
      });

      if (!activeSub) {
        throw new ForbiddenException('プラン購読が必要です');
      }

      return { post, canView: true };
    }

    /** 5. PPV投稿 → 購入済みかチェック */
    if (post.visibility === Visibility.paid_single) {
      const access = await this.prisma.postAccess.findUnique({
        where: {
          userId_postId: { userId: viewerId, postId },
        },
      });

      if (!access || (access.expiresAt && access.expiresAt <= new Date())) {
        throw new ForbiddenException('PPV購入が必要です');
      }

      return { post, canView: true };
    }

    throw new ForbiddenException('閲覧権限がありません');
  }
}
