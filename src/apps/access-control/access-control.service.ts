import { Injectable, NotFoundException } from '@nestjs/common';
import { PaymentKind, PaymentStatus, Visibility, SubStatus } from '@prisma/client';
import { PrismaService } from 'src/apps/prisma/prisma.service';

@Injectable()
export class AccessControlService {
  constructor(private prisma: PrismaService) {}

  async canViewPost(postId: string, viewerId?: string) {
    // A) 入口ログ（誰が何を見ようとしているか）
    console.log('[canViewPost:req]', { postId, viewerId });

    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      select: { 
        id: true, 
        visibility: true, 
        creatorId: true, 
        planId: true, 
        priceJpy: true 
      },
    });

    // B) 投稿取得結果
    console.log('[canViewPost:post]', post);
    if (!post) throw new NotFoundException();

    // C) free 判定前（ここで早期returnならOK）
    if (post.visibility === 'free') {
      console.log('[canViewPost:free] allow');
      return true;
    }

    // D) 未ログイン
    if (!viewerId) {
      console.log('[canViewPost:auth] deny (need login)');
      return false;
    }

    // E) 作者本人
    if (viewerId === post.creatorId) {
      console.log('[canViewPost:self] allow');
      return true;
    }

    // F) plan 分岐
    if (post.visibility === Visibility.plan) {
      if (!post.planId) {
        console.log('[canViewPost:plan] deny (no planId)');
        return false;
      }

      const now = new Date();
      const sub = await this.prisma.subscription.findFirst({
        where: {
          userId: viewerId,
          planId: post.planId,
          status: { in: [SubStatus.active, SubStatus.trialing] },
          currentPeriodEnd: { gt: now },
        },
      });
      console.log('[canViewPost:plan] sub=', !!sub, sub && {
        id: sub.id,
        status: sub.status,
        currentPeriodEnd: sub.currentPeriodEnd,
      });
      return !!sub;
    }

    // 4) 単品課金 (PPV)
    if (post.visibility === Visibility.paid_single) {
      const access = await this.prisma.postAccess.findUnique({
        where: {
          userId_postId: {
            userId: viewerId,
            postId: post.id,
          },
        },
      });

      console.log('[canViewPost:ppv] access=', !!access, access && {
        id: access.id,
        expiresAt: access.expiresAt,
      });

      if (!access) return false;

      // 有効期限付きにする場合はこちらで判定
      if (access.expiresAt && access.expiresAt <= new Date()) {
        console.log('[canViewPost:ppv] expired');
        return false;
      }

      return true;
    }

    console.log('[canViewPost:unknownVisibility] deny', post.visibility);
    return false;
  }

}
