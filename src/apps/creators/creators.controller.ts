// api/src/apps/creators/creators.controller.ts

import {
  Controller, Get, Post, Body, UseGuards, Request, Param, NotFoundException,
  ForbiddenException, UnauthorizedException, BadRequestException, Req,
  Patch,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CreatorsService } from './creators.service';
import { CreateCreatorDto } from './dto/create-creator.dto';
import { CreatePostDto } from '../posts/dto/create-post.dto';
import { PublishedStatus, Role } from '@prisma/client';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UpdateCreatorProfileDto } from './dto/update-creator-profile.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { extname } from 'path';
import { diskStorage } from 'multer';

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
        _count: {
          select: {
            posts: {
              where: {
                publishedStatus: PublishedStatus.published,  // ★ draft/private除外
              },
            },
          },
        },
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

  // クリエイター本人用の情報取得
  @UseGuards(JwtAuthGuard, RolesGuard)
  // admin も自分の Creator 情報を取れるようにする
  @Roles(Role.fan, Role.creator, Role.admin)
  @Get('me')
  getMe(@Req() req) {
    const userId = req.user.id;
    if (!userId) {
      throw new UnauthorizedException('JWTが無効です');
    }    
    return this.creatorsService.getMe(userId);
  }  

  // ★ プロフィール更新: PATCH /creators/me
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.creator, Role.admin)
  @Patch('me')
  async updateMe(
    @Req() req,
    @Body() dto: UpdateCreatorProfileDto,
  ) {
    const userId = req.user.id;
    if (!userId) {
      throw new UnauthorizedException('JWTが無効です');
    }
    return this.creatorsService.updateProfile(userId, dto);
  }  

  // ★ 追加：アバターアップロード
  @Post('me/avatar')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: 'uploads/creators',
        filename: (req:any, file, cb) => {
          const ext = extname(file.originalname);
          const name = `creator-${req.user.id}-${Date.now()}${ext}`;
          cb(null, name);
        },
      }),
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB など
    }),
  )
  async uploadAvatar(@UploadedFile() file: any, @Req() req : any,) {
    const userId = req.user.id;

    // 公開URLを組み立て（/uploads を StaticAssets で公開している前提）
    const avatarUrl = `/uploads/creators/${file.filename}`;

    await this.creatorsService.updateProfile(userId, { avatarUrl });

    return { url: avatarUrl };
  }  

  // 詳細: GET /creators/:id
  @Get(':id')
  async detail(@Param('id') id: string) {
    const c = await this.prisma.creator.findUnique({
      where: { userId: id },
      select: {
        userId: true,
        publicName: true,
        user: {
          select: {
            profile: {
              select: {
                bio: true,
                avatarUrl: true,
                displayName: true,
              },
            },
          },
        },
        plans: {
          where: { isActive: true },
          select: {
            id: true,
            name: true,
            priceJpy: true,
            billingInterval: true,
            isActive: true,
            sortOrder: true,
          },
          // 並び順変えたいなら sortOrder 優先でもOK
          orderBy: [
            { sortOrder: 'asc' },
            { createdAt: 'asc' },
          ],
        },
      },
    });

    if (!c) {
      throw new NotFoundException('クリエイターが見つかりません');
    }

    return {
      id: c.userId,
      // publicName をそのまま出す（フロントでは displayName 的に使う）
      publicName: c.publicName,
      // Profile があればそこから bio / avatar も返す
      bio: c.user.profile?.bio ?? null,
      avatarUrl: c.user.profile?.avatarUrl ?? null,
      displayName: c.user.profile?.displayName ?? c.publicName,
      plans: c.plans.map((p) => ({
        id: p.id,
        name: p.name,
        // ★ schema と同じキー名で返す
        priceJpy: p.priceJpy,
        billingInterval: p.billingInterval ?? 'month',
        isActive: p.isActive,
        sortOrder: p.sortOrder,
      })),
    };
  }

  // 投稿一覧: GET /creators/:id/posts
  @Get(':id/posts')
  async posts(@Param('id') id: string) {
    const posts = await this.prisma.post.findMany({
      where: {
        creatorId: id,
        publishedStatus: PublishedStatus.published,
      },
      select: {
        id: true,
        title: true,
        visibility: true,
        priceJpy: true,
        publishedStatus: true,
        publishedAt: true,
        createdAt: true,
        creatorId: true,

        // ★ Creator -> User -> Profile(displayName)
        creator: {
          select: {
            user: {
              select: {
                profile: {
                  select: { displayName: true },
                },
              },
            },
          },
        },

        _count: {
          select: { reports: true },
        },
      },
      orderBy: { publishedAt: 'desc' },
      take: 20,
    });

    const items = posts.map((p) => ({
      id: p.id,
      title: p.title,
      visibility: p.visibility,
      priceJpy: p.priceJpy ?? null,
      publishedStatus: p.publishedStatus,
      publishedAt: p.publishedAt,
      createdAt: p.createdAt,
      creatorId: p.creatorId ?? null,
      // optional chaining で型安全に
      creatorName: p.creator?.user.profile?.displayName ?? null,
      reportsCount: p._count.reports ?? 0,
    }));

    return { items };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/posts')
  async myPosts(@Req() req: any) {
    const userId = req.user.id as string;
    if (!userId) {
      throw new UnauthorizedException('JWTが無効です');
    }

    const posts = await this.prisma.post.findMany({
      where: { creatorId: userId },
      select: {
        id: true,
        title: true,
        visibility: true,
        priceJpy: true,
        publishedStatus: true,
        publishedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const toDto = (p: typeof posts[number]) => ({
      id: p.id,
      title: p.title,
      visibility: p.visibility,
      priceJpy: p.priceJpy ?? null,
      publishedStatus: p.publishedStatus,
      publishedAt: p.publishedAt,
      createdAt: p.createdAt,
    });

    const published = posts
      .filter((p) => p.publishedStatus === PublishedStatus.published)
      .map(toDto);

    const drafts = posts
      .filter((p) => p.publishedStatus !== PublishedStatus.published)
      .map(toDto);

    return { published, drafts };
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

  // 本人確認を開始（StripeのKYC画面URLを返す）
  @UseGuards(JwtAuthGuard)
  @Post('me/kyc/start')
  async startKyc(@Req() req: any) {
    const userId = req.user.id as string;
    return this.creatorsService.startKyc(userId);
  }  
}
