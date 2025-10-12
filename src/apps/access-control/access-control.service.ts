import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/apps/prisma/prisma.service';

@Injectable()
export class AccessControlService {
  constructor(private prisma: PrismaService) {}

  // viewerId は string（未ログインは undefined）
  async canViewPost(postId: string, viewerId?: string) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      select: { id: true, visibility: true, creatorId: true, planId: true },
    });
    if (!post) throw new NotFoundException();

    if (post.visibility === 'free') return true;
    if (!viewerId) return false;

    // 作者は閲覧可（運用ポリシーに応じて外してもOK）
    if (viewerId === post.creatorId) return true;

    // プラン限定なのに planId が無ければ不可
    if (!post.planId) return false;

    const active = await this.prisma.subscription.findFirst({
      where: {
        userId: viewerId,           // ← string
        planId: post.planId,        // ← string（null考慮済）
        status: 'active',
      },
    });
    return !!active;
  }
}
