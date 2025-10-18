// src/apps/posts/posts.create.controller.ts
import {
  Controller,
  Post,
  Body,
  UseGuards,
  Req,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePostDto } from './dto/create-post.dto';

type UserJwt = {
  sub: string;              // userId
  role: 'fan' | 'creator' | 'admin';
  email?: string;
};

@Controller()
export class PostsCreateController {
  constructor(private prisma: PrismaService) {}

  // エイリアス: /posts と /creators/me/posts の両方を受ける
  @UseGuards(JwtAuthGuard)
  @Post('posts')
  async createAtPosts(@Body() dto: CreatePostDto, @Req() req: any) {
    const user = req.user as UserJwt | undefined;
    return this.createImpl(dto, user?.sub, user?.role);
  }

  @UseGuards(JwtAuthGuard)
  @Post('creators/me/posts')
  async createAtCreatorsMe(@Body() dto: CreatePostDto, @Req() req: any) {
    const user = req.user as UserJwt | undefined;
    return this.createImpl(dto, user?.sub, user?.role);
  }

  /**
   * 投稿作成本体
   *
   * - クリエイター権限チェック
   * - 入力バリデーション
   * - Creator を upsert で「存在保証」
   * - planId が指定された場合は「同一クリエイターのプランか」を所有チェック
   * - Post は creatorId 直書きではなく relation connect({ userId }) で作成
   */
  private async createImpl(dto: CreatePostDto, userId?: string, role?: string) {
    if (!userId) throw new ForbiddenException('ログインが必要です');
    if (role !== 'creator') throw new ForbiddenException('クリエイターのみ投稿できます');

    // ---- 入力バリデーション ----
    const title = (dto.title ?? '').trim();
    if (!title) throw new BadRequestException('title は必須です');

    const visibility = dto.visibility as 'free' | 'plan' | 'paid_single';
    if (!['free', 'plan', 'paid_single'].includes(visibility)) {
      throw new BadRequestException('visibility が不正です');
    }

    if (visibility === 'plan' && !dto.planId) {
      throw new BadRequestException('planId が必要です（visibility=plan）');
    }

    // 価格は整数・下限チェック
    let priceJpy: number | null = null;
    if (visibility === 'paid_single') {
      const n = Number(dto.priceJpy);
      if (!Number.isFinite(n)) throw new BadRequestException('priceJpy が不正です');
      const int = Math.trunc(n);
      if (int < 100) throw new BadRequestException('priceJpy は100円以上にしてください');
      priceJpy = int;
    }

    // ステータス（下書き/公開）判定を明確化
    // - dto.status === 'draft' を下書き扱い
    // - それ以外や未指定は公開（isPublished=true）にする
    const isDraft =
      (typeof dto.status === 'string' && dto.status.toLowerCase() === 'draft') ||
      (dto as any).isPublished === false;
    const now = new Date();

    // 本文は bodyMd を優先、無ければ body を使う（両方無ければ空）
    const bodyMd: string = (dto as any).bodyMd ?? (dto as any).body ?? '';

    // 年齢区分はクライアントから来なければ既定値
    const ageRating = (dto as any).ageRating ?? 'all';

    // ---- Creator を upsert で存在保証（冪等）----
    // 本番で Seed を回していなくてもここで必ず作られる
    await this.prisma.creator.upsert({
      where: { userId },
      update: {},
      create: {
        userId,
        publicName: '',
        isListed: false,
      },
    });

    // ---- planId 所有チェック（他人のプランを付けられないように）----
    let planId: string | null = null;
    if (visibility === 'plan') {
      const plan = await this.prisma.plan.findUnique({
        where: { id: dto.planId! },
        select: { id: true, creatorId: true, isActive: true },
      });
      if (!plan) throw new BadRequestException('指定の planId が存在しません');
      if (plan.creatorId !== userId) {
        throw new BadRequestException('planId が不正です（他のクリエイターのプラン）');
      }
      if (!plan.isActive) {
        throw new BadRequestException('指定のプランは非アクティブです');
      }
      planId = plan.id;
    }

    // ---- Post 作成（creator: connect を使用）----
    const post = await this.prisma.post.create({
      data: {
        creator: { connect: { userId } }, // ★ FK を安全に張る
        title,
        bodyMd,
        visibility: visibility as any, // Prisma の Enum に合わせて as any でキャスト
        ...(visibility === 'plan' && planId
          ? { plan: { connect: { id: planId } } }
          : {}),
        ...(priceJpy != null ? { priceJpy } : {}),
        isPublished: !isDraft,
        publishedAt: !isDraft ? now : null,
        ageRating: ageRating as any,
      },
      select: {
        id: true,
        title: true,
        visibility: true,
        planId: true,
        priceJpy: true,
        isPublished: true,
        publishedAt: true,
        createdAt: true,
      },
    });

    return { ok: true, post };
  }
}
