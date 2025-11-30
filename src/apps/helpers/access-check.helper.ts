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
   * 投稿閲覧権限チェック
   */
  async assertCanViewPost(
    user: { id: string; role: Role } | string | null,   // ★ ここを変更
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

    // ★ 引数を共通フォーマットに正規化
    const userId =
      typeof user === 'string' ? user : user?.id ?? null;
    const userRole =
      typeof user === 'string' ? null : user?.role ?? null;

    // ★ 管理者はすべての投稿を閲覧可能（下書き／有料問わず）
    if (userRole === Role.admin) {
      return { post, canView: true };
    }

    // 投稿者本人はステータス/公開範囲に関係なく閲覧可（クリエイター）
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
      if (!post.planId || !post.creatorId) {
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

    throw new ForbiddenException('この投稿を閲覧する権限がありません');
  }
}
