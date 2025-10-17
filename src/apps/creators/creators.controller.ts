import {
  Controller, Get, Post, Body, UseGuards, Request, Param, NotFoundException,
  ForbiddenException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CreatorsService } from './creators.service';
import { CreateCreatorDto, Visibility } from './dto/create-creator.dto';
import { CreatePostDto } from '../posts/dto/create-post.dto';

@Controller('creators')
export class CreatorsController {
  constructor(
    private readonly creatorsService: CreatorsService,
    private prisma: PrismaService,
  ) {}

  // 申請（そのままでOK）
  @UseGuards(JwtAuthGuard)
  @Post()
  async applyAsCreator(@Request() req, @Body() dto: CreateCreatorDto) {
    return this.creatorsService.applyCreator(req.user.sub, dto);
  }

  /**
   * 一覧: GET /creators
   * - Creator を起点に取得
   * - 公開中のみ出すなら isListed: true で絞る
   */
  @Get()
  async list() {
    const rows = await this.prisma.creator.findMany({
      where: {
        isListed: true, // 必要に応じて外してOK
        user: { isActive: true, role: 'creator' },
      },
      select: {
        userId: true,
        publicName: true,
        _count: { select: { posts: true } }, // Creator側にpostsがあるのでOK
      },
      orderBy: { createdAt: 'desc' },
      take: 12,
    });

    const items = rows.map((c) => ({
      id: c.userId,                         // ← フロントの :id には userId を使う
      displayName: c.publicName,
      postsCount: c._count.posts ?? 0,
    }));

    return { items };
  }

  /**
   * 詳細: GET /creators/:id
   * - :id は User.id（= Creator.userId）
   * - Plan.priceJpy を UI用の price にマップ
   * - interval はスキーマに無いので 'month' を暫定固定
   */
  @Get(':id')
  async detail(@Param('id') id: string) {
    const c = await this.prisma.creator.findUnique({
      where: { userId: id },
      select: {
        userId: true,
        publicName: true,
        plans: {
          where: { isActive: true },
          select: {
            id: true,
            name: true,
            priceJpy: true, // ★ priceではなくpriceJpy
            // interval はスキーマに無い
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
        price: p.priceJpy,   // ← フロントの想定に合わせてプロパティ名を変換
        interval: 'month',   // ← 暫定で固定（必要ならバックエンドにenum追加）
      })),
    };
  }

  /**
   * （任意）投稿一覧: GET /creators/:id/posts
   * - Post.creatorId は Creator.userId を参照しているスキーマなので、where は creatorId = :id
   */
  @Get(':id/posts')
  async posts(@Param('id') id: string) {
    const posts = await this.prisma.post.findMany({
      where: { creatorId: id, isPublished: true },
      select: { id: true, title: true, visibility: true, priceJpy: true, publishedAt: true },
      orderBy: { publishedAt: 'desc' },
      take: 20,
    });

    // フロント互換の簡易整形
    const items = posts.map((p) => ({
      id: p.id,
      title: p.title,
      isFree: p.visibility === 'free',
      price: p.priceJpy ?? null,
    }));
    return { items };
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/posts')
  async createMyPost(@Request() req, @Body() dto: CreatePostDto) {
    const userId: string | undefined = req.user?.sub;
    const role: string | undefined = req.user?.role;

    if (!userId) throw new UnauthorizedException('JWTが無効です');        // ← 401
    if (role !== 'creator') throw new ForbiddenException('クリエイターのみ投稿可能です'); // ← 403

    const creator = await this.prisma.creator.findUnique({ where: { userId } });
    if (!creator) throw new ForbiddenException('クリエイター登録が必要です');          // ← 403（原因特定しやすく）

    if ((dto.visibility === Visibility.plan || dto.visibility === Visibility.paid_single) && !dto.priceJpy) {
      throw new BadRequestException('有料/PPV は price が必要です');                // ← 400
    }

    const post = await this.prisma.post.create({
      data: {
        creatorId: userId,
        title: dto.title,
        bodyMd: dto.body ?? '',
        visibility: dto.visibility,          // 'free' | 'paid' | 'ppv'
        priceJpy: dto.priceJpy ?? null,
        isPublished: dto.status === 'published',
        publishedAt: dto.status === 'published' ? new Date() : null,
      },
      select: { id: true, title: true, visibility: true, priceJpy: true, isPublished: true, publishedAt: true },
    });

    return {
      id: post.id,
      title: post.title,
      isFree: post.visibility === 'free',
      price: post.priceJpy ?? null,
      published: post.isPublished,
      publishedAt: post.publishedAt,
    };
  }  

  @Post(':creatorId/plans/:planId/checkout')
  async createCheckout(
    @Param('creatorId') creatorId: string,
    @Param('planId') planId: string,
  ) {
    // plan をDBから取得して priceId を得る（例: plan.stripePriceId）
    const sessionUrl = await this.creatorsService.createSubscriptionCheckout(creatorId, planId);
    return { url: sessionUrl };
  }
}
