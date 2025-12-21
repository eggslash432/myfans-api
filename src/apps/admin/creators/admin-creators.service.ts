// api/src/apps/admin/creators/admin-creators.service.ts

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatorApprovalStatus } from '@prisma/client';

export class AdminCreatorsService {
  constructor(private readonly prisma: PrismaService) {}

  async listApplications(params: { status?: CreatorApprovalStatus; q?: string }) {
    const { status, q } = params;

    const where: any = {};
    if (status) where.approvalStatus = status;

    if (q?.trim()) {
      const keyword = q.trim();
      where.OR = [
        { publicName: { contains: keyword, mode: 'insensitive' } },
        { user: { email: { contains: keyword, mode: 'insensitive' } } },
        {
          user: {
            profile: {
              is: { displayName: { contains: keyword, mode: 'insensitive' } },
            },
          },
        },
      ];
    }

    const rows = await this.prisma.creator.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      select: {
        userId: true,
        publicName: true,
        createdAt: true,
        updatedAt: true,
        approvalStatus: true,
        approvedAt: true,
        rejectedAt: true,
        rejectReason: true,
        isListed: true,
        user: {
          select: {
            email: true,
            profile: { select: { displayName: true } },
          },
        },
        _count: { select: { applications: true } },
        applications: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true },
        },
      },
    });

    return {
      items: rows.map((r) => ({
        userId: r.userId,
        email: r.user.email,
        displayName: r.user.profile?.displayName ?? null,
        publicName: r.publicName,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        approvalStatus: r.approvalStatus,
        approvedAt: r.approvedAt ?? null,
        rejectedAt: r.rejectedAt ?? null,
        rejectReason: r.rejectReason ?? null,
        isListed: r.isListed,
        applicationCount: r._count.applications,
        lastAppliedAt: r.applications[0]?.createdAt ?? null,
      })),
    };
  }

  async approve(userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const creator = await tx.creator.findUnique({
        where: { userId },
        select: { userId: true, approvalStatus: true },
      });
      if (!creator) throw new NotFoundException('クリエイターが見つかりません');

      await tx.creator.update({
        where: { userId },
        data: {
          approvalStatus: 'approved',
          approvedAt: new Date(),
          rejectedAt: null,
          rejectReason: null,
          isListed: true,
        },
      });

      await tx.notification.create({
        data: {
          userId,
          type: 'creator_approved',
          title: 'クリエイター申請が承認されました',
          body: 'クリエイター機能が利用可能になりました。プロフィール設定と本人確認（KYC）を進めてください。',
        },
      });

      return { ok: true };
    });
  }

  async reject(userId: string, reasonRaw: string) {
    const reason = (reasonRaw ?? '').trim();
    if (!reason) throw new BadRequestException('reject reason is required');

    const creator = await this.prisma.creator.findUnique({
      where: { userId },
      select: { userId: true },
    });
    if (!creator) throw new NotFoundException('クリエイターが見つかりません');

    await this.prisma.creator.update({
      where: { userId },
      data: {
        approvalStatus: 'rejected',
        rejectedAt: new Date(),
        approvedAt: null,
        rejectReason: reason,
        isListed: false,
      },
    });

    await this.prisma.notification.create({
      data: {
        userId,
        type: 'creator_rejected',
        title: 'クリエイター申請が差し戻されました',
        body: `差し戻し理由：${reason}`,
      },
    });

    return { ok: true };
  }

  async listCreators(params: {
    isListed?: string;
    kycStatus?: string;
    approvalStatus?: string;
  }) {
    const { isListed, kycStatus, approvalStatus } = params;

    const where: any = {};
    if (typeof isListed === 'string') {
      if (isListed === 'true') where.isListed = true;
      if (isListed === 'false') where.isListed = false;
    }
    if (kycStatus) where.stripeKycStatus = kycStatus;
    if (approvalStatus) where.approvalStatus = approvalStatus;

    const creators = await this.prisma.creator.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
            isActive: true,
            createdAt: true,
          },
        },
        _count: {
          select: {
            posts: true,
            subscriptions: true,
            payouts: true,
          },
        },
      },
    });

    return creators.map((c) => ({
      userId: c.userId,
      email: c.user?.email ?? '',
      publicName: c.publicName,
      isListed: c.isListed,
      approvalStatus: c.approvalStatus,
      approvedAt: c.approvedAt ?? null,
      rejectedAt: c.rejectedAt ?? null,
      rejectReason: c.rejectReason ?? null,
      stripeKycStatus: c.stripeKycStatus,
      stripeChargesEnabled: c.stripeChargesEnabled,
      stripePayoutsEnabled: c.stripePayoutsEnabled,
      createdAt: c.createdAt,
      userCreatedAt: c.user?.createdAt,
      postsCount: c._count.posts,
      subsCount: c._count.subscriptions,
      payoutsCount: c._count.payouts,
    }));
  }

  async getCreator(userId: string) {
    const creator = await this.prisma.creator.findUnique({
      where: { userId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
            isActive: true,
            createdAt: true,
          },
        },
        plans: true,
      },
    });

    if (!creator) throw new BadRequestException('クリエイターが見つかりません');
    return creator;
  }

  async updateListing(userId: string, isListed: boolean) {
    if (typeof isListed !== 'boolean') {
      throw new BadRequestException('isListed は boolean で指定してください');
    }

    const updated = await this.prisma.creator.update({
      where: { userId },
      data: { isListed },
    });

    return { ok: true, userId: updated.userId, isListed: updated.isListed };
  }

  async getApplicationHistory(userId: string) {
    const rows = await this.prisma.creatorApplication.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        publicName: true,
        status: true,
        rejectReason: true,
        createdAt: true,
      },
      take: 50,
    });

    return { items: rows };
  }
}
