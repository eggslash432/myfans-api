import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/apps/prisma/prisma.service';

@Injectable()
export class AccessControlService {
  constructor(private prisma: PrismaService) {}

  async canViewPost(postId: string, viewerId?: string) {
    // A) 入口ログ（誰が何を見ようとしているか）
    console.log('[canViewPost:req]', { postId, viewerId });

    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      select: { id: true, visibility: true, creatorId: true, planId: true, priceJpy: true },
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
    if (post.visibility === 'plan') {
      if (!post.planId) {
        console.log('[canViewPost:plan] deny (no planId)');
        return false;
      }
      const sub = await this.prisma.subscription.findFirst({
        where: { userId: viewerId, planId: post.planId, status: { in: ['active','trialing'] } },
      });
      console.log('[canViewPost:plan] sub=', !!sub);
      return !!sub;
    }

    // G) paid_single 分岐（PPV）
    if (post.visibility === 'paid_single') {
      const pay = await this.prisma.payment.findFirst({
        where: { userId: viewerId, postId: post.id, status: 'paid', kind: 'one_time' },
        orderBy: { createdAt: 'desc' },
      });
      console.log('[canViewPost:ppv] payment=', !!pay, pay && {
        id: pay.id, amountJpy: pay.amountJpy, paidAt: pay.paidAt,
      });
      // 金額チェックを入れるならここで enough 判定もログ
      // const enough = !post.priceJpy || (pay?.amountJpy ?? 0) >= post.priceJpy;
      // console.log('[canViewPost:ppv] enough=', enough, 'req=', post.priceJpy);
      return !!pay /* && enough */;
    }

    console.log('[canViewPost:unknown] deny');
    return false;
  }

}
