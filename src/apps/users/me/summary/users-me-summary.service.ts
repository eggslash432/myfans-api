import { Injectable, InternalServerErrorException } from '@nestjs/common'
import { PrismaService } from '../../../prisma/prisma.service'

@Injectable()
export class UsersMeSummaryService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(userId: string) {
    try {
      // 1) プロフィール（User ←→ Profile）
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          role: true,
          profile: { select: { displayName: true, avatarUrl: true, bio: true } },
        },
      })

      // user が見つからない場合でも 200 で空を返す（ここで throw しない）
      const profile = user
        ? {
            id: user.id,
            email: user.email,
            role: user.role,
            displayName: user.profile?.displayName ?? null,
            avatarUrl: user.profile?.avatarUrl ?? null,
            bio: user.profile?.bio ?? null,
          }
        : { id: userId, email: null, role: null, displayName: null, avatarUrl: null, bio: null }

      // 2) 購読（Subscription → Plan → Creator）
      const subs = await this.prisma.subscription.findMany({
        where: { userId },
        orderBy: { currentPeriodStart: 'desc' },
        include: {
          plan: {
            include: {
              creator: { select: { userId: true, publicName: true } },
            },
          },
        },
      })

      const subscriptions = subs.map((s) => ({
        id: s.id,
        status: s.status,
        startedAt: s.currentPeriodStart,
        renewAt: s.currentPeriodEnd,
        planId: s.plan?.id ?? null,
        planName: s.plan?.name ?? null,
        priceJpy: s.plan?.priceJpy ?? null,
        creatorId: s.plan?.creator?.userId ?? null,
        creatorName: s.plan?.creator?.publicName ?? null,
      }))

      // 3) 支払い（Payment → Plan / Post）
      const paymentsRaw = await this.prisma.payment.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: {
          plan: { select: { name: true } },
          post: { select: { title: true } },
        },
      })

      const payments = paymentsRaw.map((p) => ({
        id: p.id,
        amount: p.amountJpy,
        kind: p.kind,
        status: p.status,
        title: p.plan?.name ?? p.post?.title ?? '-',
        paidAt: p.paidAt,
        createdAt: p.createdAt,
      }))

      return { profile, subscriptions, payments }
    } catch (e: any) {
      // ここで詳細ログを出しておくと原因特定が早い
      console.error('[users/me/summary] failed:', e?.message, e?.stack)
      throw new InternalServerErrorException('summary_build_failed')
    }
  }
}
