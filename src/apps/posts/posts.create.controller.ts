// api/src/apps/posts/posts.create.controller.ts
import {
  Controller,
  Post,
  Body,
  UseGuards,
  Req,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePostDto } from './dto/create-post.dto';
import { PublishedStatus, Role, Visibility } from '@prisma/client';
import { UserJwt } from 'src/shared/types';
import { CreatorHelper } from '../helpers/creator.helper';

@Controller()
export class PostsCreateController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly creatorHelper: CreatorHelper,
  ) {}

  /**
   * エイリアス①: POST /posts
   *  - createPostSmart() の候補パスその1
   */
  @UseGuards(JwtAuthGuard)
  @Post('posts')
  async createAtPosts(@Body() dto: CreatePostDto, @Req() req: any) {
    return this.createImpl(dto, req);
  }

  /**
   * エイリアス②: POST /creators/me/posts
   *  - createPostSmart() の候補パスその2
   */
  @UseGuards(JwtAuthGuard)
  @Post('creators/me/posts')
  async createAtCreatorsMe(@Body() dto: CreatePostDto, @Req() req: any) {
    return this.createImpl(dto, req);
  }

  /**
   * 共通実装
   */
  private async createImpl(dto: CreatePostDto, req: any) {
    const user = req.user as UserJwt | undefined;
    if (!user?.id) {
      throw new UnauthorizedException('ログインが必要です');
    }

    // 権限チェック
    if (user.role !== Role.creator && user.role !== Role.admin) {
      throw new ForbiddenException('投稿権限がありません');
    }

    // ★ creator の場合だけ Creator を紐付け
    let creatorId: string | null = null;
    if (user.role === Role.creator) {
      creatorId = await this.creatorHelper.getMyCreatorId(user.id);
    }

    // ---------------------------------------------
    // 🔥 admin のときは「無料投稿」へ強制
    // ---------------------------------------------
    const visibility: Visibility =
      user.role === Role.admin ? Visibility.free : dto.visibility;

    const planId: string | null =
      user.role === Role.admin
        ? null
        : dto.visibility === Visibility.plan
        ? dto.planId ?? null
        : null;

    const priceJpy: number | null =
      user.role === Role.admin
        ? null
        : dto.visibility === Visibility.paid_single
        ? dto.priceJpy ?? null
        : null;

    // ---------------------------------------------

    // 公開ステータス（draft / published）
    const toPublishedStatus = (v: unknown): PublishedStatus => {
      if (typeof v === 'boolean') {
        return v ? PublishedStatus.published : PublishedStatus.draft;
      }
      if (typeof v === 'string') {
        const s = v.toLowerCase();
        if (s === 'published') return PublishedStatus.published;
        if (s === 'private') return PublishedStatus.private;
        return PublishedStatus.draft;
      }
      return PublishedStatus.draft;
    };

    const pub = toPublishedStatus(
      (dto as any).publishedStatus ?? (dto as any).status,
    );
    const pubAt = pub === PublishedStatus.published ? new Date() : null;

    const post = await this.prisma.post.create({
      data: {
        title: dto.title,
        body: dto.body,
        ageRating: dto.ageRating,

        // ★ dto ではなくローカル変数を使う（admin 上書き済み）
        visibility,
        planId,
        priceJpy,

        // Creator
        creatorId,

        // 公開状態
        publishedStatus: pub,
        publishedAt: pubAt,
      },
      select: {
        id: true,
        title: true,
        media: true,
        visibility: true,
        planId: true,
        priceJpy: true,
        publishedStatus: true,
        publishedAt: true,
        createdAt: true,
      },
    });

    return { ok: true, post };
  }

}
