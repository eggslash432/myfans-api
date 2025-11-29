// api/src/apps/creators/creators.controller.ts

import {
  Controller, Get, Post, Body, UseGuards, Request, Param, NotFoundException,
  ForbiddenException, UnauthorizedException, BadRequestException, Req,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CreatorsService } from './creators.service';
import { CreateCreatorDto } from './dto/create-creator.dto';
import { CreatePostDto } from '../posts/dto/create-post.dto';
import { PublishedStatus, Role } from '@prisma/client';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('creators')
export class CreatorsController {
  constructor(
    private readonly creatorsService: CreatorsService,
    private prisma: PrismaService,
  ) {}

  // 申請
  @UseGuards(JwtAuthGuard)
  @Post()
  async applyCreator(@Req() req: any, @Body() dto: CreateCreatorDto) {
    const userId = req.user.id;
    return this.creatorsService.applyCreator(userId, dto);
  }

  // 一覧: GET /creators
  @Get()
  async list() {
    const rows = await this.prisma.creator.findMany({
      where: {
        isListed: true,
        user: { isActive: true, role: 'creator' },
      },
      select: {
        userId: true,
        publicName: true,
        _count: { select: { posts: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 12,
    });

    const items = rows.map((c) => ({
      id: c.userId,
      displayName: c.publicName,
      postsCount: c._count.posts ?? 0,
    }));

    return { items };
  }

  // 詳細: GET /creators/:id
  @Get(':id')
  async detail(@Param('id') id: string) {
    const c = await this.prisma.creator.findUnique({
      where: { userId: id }, // userId が string の想定（schema/migrationに合わせる）
      select: {
        userId: true,
        publicName: true,
        plans: {
          where: { isActive: true },
          select: {
            id: true,
            name: true,
            priceJpy: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!c) throw new NotFoundException('creator not found');

    return {
      id: c.userId,
      displayName: c.publicName,
      plans: c.plans.map((p) => ({
        id: p.id,
        name: p.name,
        price: p.priceJpy,
        interval: 'month',
      })),
    };
  }

  // 投稿一覧: GET /creators/:id/posts
  @Get(':id/posts')
  async posts(@Param('id') id: string) {
    console.log('GET /creators/:id/posts', id);
    const posts = await this.prisma.post.findMany({
      where: {
        creatorId: id,
        publishedStatus: PublishedStatus.published, // ← enumで比較
      },
      select: {
        id: true,
        title: true,
        visibility: true,    // ← select は boolean 指定
        priceJpy: true,
        publishedAt: true,
      },
      orderBy: { publishedAt: 'desc' },
      take: 20,
    });
    console.log('posts found =', posts);

    const items = posts.map((p) => ({
      id: p.id,
      title: p.title,
      isFree: p.visibility === 'free',   // DB側が 'free' | 'plan' | 'paid_single' 想定
      price: p.priceJpy ?? null,
    }));
    return { items };
  }

  // 自分の投稿作成: POST /creators/me/posts
  @UseGuards(JwtAuthGuard)
  @Post('me/posts')
  async createMyPost(@Request() req, @Body() dto: CreatePostDto) {
    const userId: string | undefined = req.user?.id;
    const role: Role | undefined = req.user?.role;

    if (!userId) throw new UnauthorizedException('JWTが無効です');
    if (role !== Role.creator && role !== Role.admin) {
      throw new ForbiddenException('クリエイターのみ投稿可能です');
    }

    const creator = await this.prisma.creator.findUnique({ where: { userId } });
    if (!creator) throw new ForbiddenException('クリエイター登録が必要です');

    // 有料/PPV のときは price 必須
    if ((dto.visibility === 'plan' || dto.visibility === 'paid_single') && !dto.priceJpy) {
      throw new BadRequestException('有料/PPV は price が必要です');
    }

    // DTOの status/publishedStatus を enum に正規化
    const toPublishedStatus = (v: any): PublishedStatus => {
      if (!v) return PublishedStatus.draft;
      const s = String(v).toUpperCase();
      if (s === 'PUBLISHED') return PublishedStatus.published;
      if (s === 'PRIVATE')   return PublishedStatus.private;
      return PublishedStatus.draft;
    };
    // dto.publishedStatus（enum or string）/ dto.status（文字列）のどちらでも受ける
    const normalized = toPublishedStatus((dto as any).publishedStatus ?? (dto as any).status);
    const pubAt = normalized === PublishedStatus.published ? new Date() : null;

    const post = await this.prisma.post.create({
      data: {
        creatorId: userId,
        title: dto.title,
        body: dto.body ?? '',
        visibility: dto.visibility,          // 'free' | 'plan' | 'paid_single'
        priceJpy: dto.priceJpy ?? null,
        publishedStatus: normalized,         // ← boolean ではなく enum
        publishedAt: pubAt,
      },
      select: {
        id: true,
        title: true,
        visibility: true,
        priceJpy: true,
        publishedStatus: true,               // ← select は true
        publishedAt: true,
      },
    });

    return {
      id: post.id,
      title: post.title,
      isFree: post.visibility === 'free',
      price: post.priceJpy ?? null,
      publishedStatus: post.publishedStatus,
      publishedAt: post.publishedAt,
    };
  }

  @Post(':creatorId/plans/:planId/checkout')
  async createCheckout(
    @Param('creatorId') creatorId: string,
    @Param('planId') planId: string,
  ) {
    const sessionUrl = await this.creatorsService.createSubscriptionCheckout(creatorId, planId);
    return { url: sessionUrl };
  }

  // クリエイター本人用の情報取得
  @UseGuards(JwtAuthGuard, RolesGuard)
  // admin も自分の Creator 情報を取れるようにする
  @Roles(Role.fan, Role.creator, Role.admin)
  @Get('me')
  getMe(@Req() req) {
    const userId = req.user.id;
    return this.creatorsService.getMe(userId);
  }

  // 本人確認を開始（StripeのKYC画面URLを返す）
  @UseGuards(JwtAuthGuard)
  @Post('me/kyc/start')
  async startKyc(@Req() req: any) {
    const userId = req.user.id as string;
    return this.creatorsService.startKyc(userId);
  }  
}
