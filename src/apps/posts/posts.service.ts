import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Visibility, SubStatus } from '@prisma/client';
import { AccessControlService } from '../access-control/access-control.service';

@Injectable()
export class PostsService {
  constructor(private prisma: PrismaService, private ac: AccessControlService) {}

  async getPost(postId: string, viewerId?: string) {
    const ok = await this.ac.canViewPost(postId, viewerId);
    if (!ok) throw new ForbiddenException('購読が必要です');
    return this.prisma.post.findUnique({ where: { id: postId } });
  }

  async findOne(id: string, viewerUserId?: string) {
    const post = await this.prisma.post.findUnique({ where: { id } });
    if (!post) throw new NotFoundException('投稿が見つかりません');

    // free : 誰でもOK
    if (post.visibility === Visibility.free) {
      return post;
    }

    // plan : ログイン必須
    if (post.visibility === Visibility.plan) {
      if (!viewerUserId) throw new ForbiddenException('ログインが必要です');

      // 自分（投稿者/クリエイター）本人は常に閲覧可
      if (viewerUserId === post.creatorId) return post;

      // 購読者（active or trialing）だけ閲覧可
      const allowedStatuses: SubStatus[] = [SubStatus.active, SubStatus.trialing];
      const sub = await this.prisma.subscription.findFirst({
        where: {
          userId: viewerUserId,
          planId: post.planId!, // plan 投稿なら必ず存在
          status: { in: allowedStatuses },
        },
      });
      if (!sub) throw new ForbiddenException('この投稿を閲覧するには購読が必要です');

      return post;
    }

    // paid_single : まだ未対応 → 一律禁止（後で実装）
    if (post.visibility === Visibility.paid_single) {
      // 例：単品購入の Payment があるか確認する実装に差し替える
      throw new ForbiddenException('有料単品投稿のアクセス権がありません');
    }

    // ここに来ない想定
    throw new ForbiddenException('アクセスできません');
  }
}
