// api/src/apps/plans/plans.controller.ts

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlansService } from './plans.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { PrismaService } from '../prisma/prisma.service';
import { BillingInterval } from '@prisma/client';
import { CreatorOnlyGuard } from '../access-control/creator-only.guard';
import { CreatorHelper } from '../helpers/creator.helper';
import { UserJwt } from 'src/shared/types';
import Stripe from 'stripe';

const stripeSecret = process.env.STRIPE_SECRET_KEY;
if (!stripeSecret) {
  // 起動時に落ちてくれた方が分かりやすいのでここでチェック
  throw new Error('STRIPE_SECRET_KEY is not set');
}
const stripe = new Stripe(stripeSecret, {});

@Controller('plans')
export class PlansController {
  constructor(
    private readonly plans: PlansService,
    private readonly prisma: PrismaService,
    private readonly creatorHelper: CreatorHelper,
  ) {}

  // ======================
  // 作成
  // ======================
  @Post()
  @UseGuards(JwtAuthGuard, CreatorOnlyGuard)
  async create(@Body() dto: CreatePlanDto, @Req() req: any) {
    const user = req.user as UserJwt | undefined;
    if (!user?.id) throw new ForbiddenException();

    const creatorId = await this.creatorHelper
      .getMyCreatorId(user.id)
      .catch(() => null);
    if (!creatorId) {
      throw new ForbiddenException('クリエイター登録がありません');
    }

    // KYC チェック＋Stripe用情報取得
    const creator = await this.prisma.creator.findUnique({
      where: { userId: user.id },
      select: {
        stripeKycStatus: true,
        publicName: true,       // ★ 追加
        stripeAccountId: true,  // ★ 追加
      },
    });

    if (!creator || creator.stripeKycStatus !== 'approved') {
      throw new ForbiddenException(
        '本人確認（KYC）が完了していないため、プランを作成できません。',
      );
    }

    try {
      const sortOrder = await this.plans.getNextSortOrder(creatorId);

      // ===== Stripe Product / Price 作成 =====
      const interval: 'month' | 'year' =
        dto.billingInterval === BillingInterval.year ? 'year' : 'month';

      // Product（商品）
      const product = await stripe.products.create(
        {
          name: `${creator.publicName} - ${dto.name}`,
        },
        creator.stripeAccountId
          ? { stripeAccount: creator.stripeAccountId }
          : undefined,
      );

      // Price（月額料金）
      const price = await stripe.prices.create(
        {
          product: product.id,
          unit_amount: dto.priceJpy, // 円 → 最小単位
          currency: 'jpy',
          recurring: { interval },
        },
        creator.stripeAccountId
          ? { stripeAccount: creator.stripeAccountId }
          : undefined,
      );

      const plan = await this.prisma.plan.create({
        data: {
          creatorId,
          name: dto.name,
          priceJpy: dto.priceJpy,
          billingInterval: dto.billingInterval ?? BillingInterval.month,
          isActive: true,
          sortOrder,
          description: dto.description ?? undefined,
          externalPriceId: price.id, // ★ ここにStripeのprice ID
        },
        select: {
          id: true,
          name: true,
          priceJpy: true,
          isActive: true,
          sortOrder: true,
        },
      });
      return plan;
    } catch (e: any) {
      const code = e?.code;
      console.error('[POST /plans] create error:', {
        msg: e?.message,
        code,
        meta: e?.meta,
      });
      if (code === 'P2003') {
        throw new BadRequestException(
          '作成に失敗：Creator が見つかりません（外部キー制約）',
        );
      }
      if (code === 'P2002') {
        throw new BadRequestException('同名のプランが既に存在します');
      }
      throw new BadRequestException(e?.message ?? '作成に失敗しました');
    }
  }


  // ======================
  // 自分のプラン一覧 (/plans/me)
  // ======================
  @UseGuards(JwtAuthGuard, CreatorOnlyGuard)
  @Get('me')
  async myPlans(@Req() req: any) {
    const user = req.user as UserJwt;
    const creatorId = await this.creatorHelper.getMyCreatorId(user.id);
    const plans = await this.prisma.plan.findMany({
      where: { creatorId },
      orderBy: [
        { sortOrder: 'asc' },
        { createdAt: 'asc' },
      ],
      select: {
        id: true,
        name: true,
        priceJpy: true,
        isActive: true,
        sortOrder: true,
      },
    });
    return { plans };
  }

  // ======================
  // プラン詳細 (/plans/:id)
  // ======================
  @UseGuards(JwtAuthGuard, CreatorOnlyGuard)
  @Get(':id')
  async getOne(@Param('id') id: string, @Req() req: any) {
    const user = req.user as UserJwt;
    const creatorId = await this.creatorHelper.getMyCreatorId(user.id);

    const plan = await this.prisma.plan.findFirst({
      where: { id, creatorId },
      select: {
        id: true,
        name: true,
        priceJpy: true,
        isActive: true,
        sortOrder: true,
        description: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!plan) throw new BadRequestException('プランが見つかりません');
    return plan;
  }

  // ======================
  // プラン編集 (/plans/:id)
  // ======================
  @UseGuards(JwtAuthGuard, CreatorOnlyGuard)
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body()
    dto: {
      name?: string;
      priceJpy?: number;
      isActive?: boolean;
      description?: string | null;
    },
    @Req() req: any,
  ) {
    const user = req.user as UserJwt;
    const creatorId = await this.creatorHelper.getMyCreatorId(user.id);

    const plan = await this.prisma.plan.findFirst({
      where: { id, creatorId },
    });
    if (!plan) throw new BadRequestException('プランが見つかりません');

    const updated = await this.prisma.plan.update({
      where: { id },
      data: {
        name: dto.name ?? plan.name,
        priceJpy:
          dto.priceJpy !== undefined ? dto.priceJpy : plan.priceJpy,
        isActive:
          dto.isActive !== undefined ? dto.isActive : plan.isActive,
        description:
          dto.description !== undefined
            ? dto.description
            : plan.description,
      },
      select: {
        id: true,
        name: true,
        priceJpy: true,
        isActive: true,
        sortOrder: true,
      },
    });

    return updated;
  }

  // ======================
  // プラン削除 (= isActive=false) (/plans/:id)
  // ======================
  @UseGuards(JwtAuthGuard, CreatorOnlyGuard)
  @Delete(':id')
  async deactivate(@Param('id') id: string, @Req() req: any) {
    const user = req.user as UserJwt;
    const creatorId = await this.creatorHelper.getMyCreatorId(user.id);

    const plan = await this.prisma.plan.findFirst({
      where: { id, creatorId },
    });
    if (!plan) throw new BadRequestException('プランが見つかりません');

    const updated = await this.prisma.plan.update({
      where: { id },
      data: { isActive: false },
      select: {
        id: true,
        name: true,
        priceJpy: true,
        isActive: true,
        sortOrder: true,
      },
    });

    return updated;
  }

  // =======================
  // プラン再開
  // PATCH /plans/:id/reactivate
  // =======================
  @UseGuards(JwtAuthGuard, CreatorOnlyGuard)
  @Patch(':id/reactivate')
  async reactivatePlan(@Param('id') id: string, @Req() req: any) {
    const user = req.user as UserJwt;
    const userId = user.id ;
    const creatorId = await this.creatorHelper.getMyCreatorId(userId);

    const plan = await this.prisma.plan.findFirst({
      where: { id, creatorId },
    });
    if (!plan) {
      throw new ForbiddenException('自分のプラン以外は操作できません');
    }

    const updated = await this.prisma.plan.update({
      where: { id },
      data: { isActive: true },
      select: { id: true, name: true, priceJpy: true, isActive: true },
    });

    return updated;
  }  

  // ======================
  // 並び順変更 (/plans/reorder)
  // ======================
  @UseGuards(JwtAuthGuard, CreatorOnlyGuard)
  @Patch('reorder')
  async reorder(
    @Body() body: { planIds: string[] },
    @Req() req: any,
  ) {
    const user = req.user as UserJwt;
    const creatorId = await this.creatorHelper.getMyCreatorId(user.id);

    const ids = body.planIds ?? [];
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new BadRequestException('planIds が空です');
    }

    // 自分の plan だけを対象にする
    const myPlans = await this.prisma.plan.findMany({
      where: { creatorId, id: { in: ids } },
      select: { id: true },
    });
    const myIds = new Set(myPlans.map((p) => p.id));

    const updates = ids
      .map((id, index) =>
        myIds.has(id)
          ? this.prisma.plan.update({
              where: { id },
              data: { sortOrder: index },
            })
          : null,
      )
      .filter(Boolean) as any[];

    await this.prisma.$transaction(updates);

    return { ok: true };
  }
}
