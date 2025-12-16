// api/src/apps/creators/creator-applications.controller.ts
import {
  Body,
  Controller,
  Post,
  Param,
  BadRequestException,
  ForbiddenException,
  Req,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  CreatorApprovalStatus,
  ShopMemberRole,
} from '@prisma/client';
import type { Request } from 'express';

@Controller('creator-applications')
export class CreatorApplicationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ==============================
  // 申請作成（Creator → Shop）
  // ==============================
  @Post()
  async create(
    @Req() req: Request,
    @Body()
    dto: {
      shopId: string;
      publicName: string;
      bankAccount?: Record<string, any>;
    },
  ) {
    const userId = String((req as any).user?.id ?? '');
    if (!userId) {
      throw new BadRequestException('ログイン情報が取得できません');
    }

    // Creator確認
    const creator = await this.prisma.creator.findUnique({
      where: { userId },
      select: { shopId: true },
    });

    if (!creator) {
      throw new BadRequestException('Creator として登録されていません');
    }

    if (creator.shopId) {
      throw new BadRequestException('すでに Shop に所属しています');
    }

    // Shop確認
    const shop = await this.prisma.shop.findUnique({
      where: { id: dto.shopId },
      select: { id: true, name: true },
    });

    if (!shop) {
      throw new BadRequestException('指定された Shop が存在しません');
    }

    // 既存申請チェック
    const existing = await this.prisma.creatorApplication.findFirst({
      where: {
        userId,
        shopId: dto.shopId,
        status: CreatorApprovalStatus.pending,
      },
    });

    if (existing) {
      throw new BadRequestException('すでに申請中です');
    }

    // 申請作成
    const application = await this.prisma.creatorApplication.create({
      data: {
        userId,
        shopId: dto.shopId,
        publicName: dto.publicName,
        bankAccount: dto.bankAccount,
        status: CreatorApprovalStatus.pending,
      },
    });

    // ---- 通知 ----

    // Shop管理者へ
    const admins = await this.prisma.shopMember.findMany({
      where: {
        shopId: dto.shopId,
        role: { in: ['owner', 'admin'] },
      },
      select: { userId: true },
    });

    await this.notifications.notifyMany(
      admins.map((a) => a.userId),
      {
        type: 'creator_application.received',
        title: 'クリエイター所属申請',
        body: `${dto.publicName} さんから所属申請が届きました`,
      },
    );

    // 申請者本人へ
    await this.notifications.notify({
      userId,
      type: 'creator_application.submitted',
      title: '所属申請を受け付けました',
      body: `${shop.name} への所属申請を受け付けました`,
    });

    return {
      id: application.id,
      status: application.status,
      createdAt: application.createdAt,
    };
  }

  // ==============================
  // 承認（Shop管理者）
  // ==============================
  @Post(':id/approve')
  async approve(
    @Req() req: Request,
    @Param('id') applicationId: string,
  ) {
    const userId = String((req as any).user?.id ?? '');
    if (!userId) throw new BadRequestException('ログイン情報が取得できません');

    const app = await this.prisma.creatorApplication.findUnique({
      where: { id: applicationId },
      include: { creator: true, shop: true },
    });

    if (!app) throw new BadRequestException('申請が存在しません');
    if (app.status !== CreatorApprovalStatus.pending) {
      throw new BadRequestException('この申請は処理済みです');
    }
    if (!app.shopId) {
      throw new BadRequestException('Shop が指定されていません');
    }

    // 承認権限チェック
    const member = await this.prisma.shopMember.findUnique({
      where: {
        shopId_userId: {
          shopId: app.shopId,
          userId,
        },
      },
    });

    if (!member || !['owner', 'admin'].includes(member.role)) {
      throw new ForbiddenException('Shop の管理権限がありません');
    }

    // ---- トランザクション ----
    await this.prisma.$transaction(async (tx) => {
      // Creator更新
      await tx.creator.update({
        where: { userId: app.userId },
        data: {
          shopId: app.shopId,
          approvalStatus: CreatorApprovalStatus.approved,
          approvedAt: new Date(),
        },
      });

      // 申請更新（冪等）
      const updated = await tx.creatorApplication.updateMany({
        where: {
          id: app.id,
          status: CreatorApprovalStatus.pending,
        },
        data: { status: CreatorApprovalStatus.approved },
      });

      if (updated.count === 0) {
        throw new BadRequestException('この申請は処理済みです');
      }

      // ShopMember（creator本人）※upsertで安全
      await tx.shopMember.upsert({
        where: {
          shopId_userId: {
            shopId: app.shopId!,
            userId: app.userId,
          },
        },
        update: { role: ShopMemberRole.staff },
        create: {
          shopId: app.shopId!,
          userId: app.userId,
          role: ShopMemberRole.staff,
        },
      });
    });

    // ---- 通知 ----
    await this.notifications.notify({
      userId: app.userId,
      type: 'creator_application.approved',
      title: '所属申請が承認されました',
      body: `${app.shop?.name ?? 'Shop'} への所属が承認されました`,
    });

    return { success: true };
  }

  // ==============================
  // 却下（Shop管理者）
  // ==============================
  @Post(':id/reject')
  async reject(
    @Req() req: Request,
    @Param('id') applicationId: string,
    @Body('reason') reason?: string,
  ) {
    const userId = String((req as any).user?.id ?? '');
    if (!userId) throw new BadRequestException('ログイン情報が取得できません');

    const app = await this.prisma.creatorApplication.findUnique({
      where: { id: applicationId },
      include: { shop: true },
    });

    if (!app) throw new BadRequestException('申請が存在しません');
    if (!app.shopId) {
      throw new BadRequestException('Shop が指定されていません');
    }

    const member = await this.prisma.shopMember.findUnique({
      where: {
        shopId_userId: {
          shopId: app.shopId,
          userId,
        },
      },
    });

    if (!member || !['owner', 'admin'].includes(member.role)) {
      throw new ForbiddenException('Shop の管理権限がありません');
    }

    // 冪等更新
    const updated = await this.prisma.creatorApplication.updateMany({
      where: {
        id: applicationId,
        status: CreatorApprovalStatus.pending,
      },
      data: {
        status: CreatorApprovalStatus.rejected,
        rejectReason: reason ?? null,
      },
    });

    if (updated.count === 0) {
      throw new BadRequestException('この申請は処理済みです');
    }

    // 通知
    await this.notifications.notify({
      userId: app.userId,
      type: 'creator_application.rejected',
      title: '所属申請が却下されました',
      body: reason
        ? `理由：${reason}`
        : `${app.shop?.name ?? 'Shop'} への所属申請は却下されました`,
    });

    return { success: true };
  }
}
