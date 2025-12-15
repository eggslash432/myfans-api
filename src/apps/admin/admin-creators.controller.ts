// api/src/apps/admin/admin-creators.controller.ts

import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminOnlyGuard } from '../access-control/admin-only.guard';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { CreatorApprovalStatus, Role } from '@prisma/client';

class UpdateListingBody {
  @IsBoolean()
  isListed!: boolean;
}

class RejectApplicationBody {
  @IsString()
  reason!: string;
}

@UseGuards(JwtAuthGuard, AdminOnlyGuard)
@Controller('admin/creators')
export class AdminCreatorsController {
  constructor(private readonly prisma: PrismaService) {}

  // ============================
  // クリエイター申請一覧（審査待ち）
  // GET /admin/creators/applications
  // ============================
  @Get('applications')
  async listApplications(
    @Query('status') status?: CreatorApprovalStatus,
    @Query('q') q?: string,
  ) {
    const where: any = {};

    if (status) where.approvalStatus = status as any;

    if (q?.trim()) {
      const keyword = q.trim();
      where.OR = [
        { publicName: { contains: keyword, mode: 'insensitive' } },
        { user: { email: { contains: keyword, mode: 'insensitive' } } },
        { user: { profile: { displayName: { contains: keyword, mode: 'insensitive' } } } },
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
          select: { createdAt: true } 
        },        
      },
    });

    return {
      items: rows.map(r => ({
        userId: r.userId,
        email: r.user.email,
        displayName: r.user.profile?.displayName ?? null,
        publicName: r.publicName,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        approvalStatus: (r as any).approvalStatus,
        approvedAt: (r as any).approvedAt ?? null,
        rejectedAt: (r as any).rejectedAt ?? null,
        rejectReason: (r as any).rejectReason ?? null,
        applicationCount: r._count.applications,
        lastAppliedAt: r.applications[0]?.createdAt ?? null,
      })),
    };
  }

  // ============================
  // 承認
  // PATCH /admin/creators/applications/:userId/approve
  // ============================
  @Patch('applications/:userId/approve')
  async approve(@Param('userId') userId: string) {
    return this.prisma.$transaction(async (tx) => {
      // creator 側：承認にする
      await tx.creator.update({
        where: { userId },
        data: {
          approvalStatus: 'approved' as any,
          approvedAt: new Date(),
          rejectedAt: null,
          rejectReason: null,
          isListed: true,
        },
      });

      // user 側：role=creator にする
      await tx.user.update({
        where: { id: userId },
        data: { role: Role.creator },
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

  // ============================
  // 却下
  // PATCH /admin/creators/applications/:userId/reject
  // body: { reason: string }
  // ============================
  @Patch('applications/:userId/reject')
  async reject(
    @Param('userId') userId: string,
    @Body() body: RejectApplicationBody,
  ) {
    const reason = (body.reason ?? '').trim();
    if (!reason) throw new BadRequestException('reject reason is required');

    await this.prisma.creator.update({
      where: { userId },
      data: {
        approvalStatus: 'rejected' as any,
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

    // role は fan のまま（方針）
    return { ok: true };
  }

  /**
   * クリエイター一覧（既存）
   * GET /admin/creators?isListed=true&kycStatus=pending
   */
  @Get()
  async listCreators(
    @Query('isListed') isListed?: string,
    @Query('kycStatus') kycStatus?: string,
    @Query('approvalStatus') approvalStatus?: string, // ★任意追加：一覧のフィルタに使える
  ) {
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
      approvalStatus: (c as any).approvalStatus,
      approvedAt: (c as any).approvedAt ?? null,
      rejectedAt: (c as any).rejectedAt ?? null,
      rejectReason: (c as any).rejectReason ?? null,
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

  /** クリエイター詳細 */
  @Get(':userId')
  async getCreator(@Param('userId') userId: string) {
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

  /** 掲載 ON/OFF */
  @Patch(':userId/listing')
  async updateListing(
    @Param('userId') userId: string,
    @Body() body: UpdateListingBody,
  ) {
    if (typeof body.isListed !== 'boolean') {
      throw new BadRequestException('isListed は boolean で指定してください');
    }

    const updated = await this.prisma.creator.update({
      where: { userId },
      data: { isListed: body.isListed },
    });

    return { ok: true, userId: updated.userId, isListed: updated.isListed };
  }

  @Get('applications/:userId/history')
  async getApplicationHistory(@Param('userId') userId: string) {
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
