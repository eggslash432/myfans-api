import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Visibility, SubStatus, PaymentStatus,PaymentKind } from '@prisma/client';
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

    // paid_single : PPV購入済みならOK
    if (post.visibility === Visibility.paid_single) {
      if (!viewerUserId) throw new ForbiddenException('ログインが必要です');
      if (viewerUserId === post.creatorId) return post; // クリエイター本人は常にOK

      const pay = await this.prisma.payment.findFirst({
        where: {
          userId: viewerUserId,
          postId: post.id,
          status: PaymentStatus.paid,
          kind: PaymentKind.one_time,
        },
        orderBy: { createdAt: 'desc' },
      });

      // 金額チェックを入れたい場合（任意）
      // const enough = !post.priceJpy || (pay?.amountJpy ?? 0) >= post.priceJpy;

      if (!pay /* || !enough */) {
        throw new ForbiddenException('この投稿を閲覧するには単品購入が必要です');
      }
      return post;
    }

    // ここに来ない想定
    throw new ForbiddenException('アクセスできません');
  }
}
