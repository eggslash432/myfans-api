// src/apps/posts/posts.create.controller.ts
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
import { PublishedStatus, Visibility } from '@prisma/client';
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

    // 自分が Creator か確認して creatorId を取得
    const creatorId = await this.creatorHelper.getMyCreatorId(user.id);

    // 受け取り値を正規化（boolean / string 両対応）
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

    // DTO 側の publishedStatus / status どちらでも受ける
    const pub = toPublishedStatus(
      (dto as any).publishedStatus ?? (dto as any).status,
    );
    const pubAt = pub === PublishedStatus.published ? new Date() : null;

    // visibility と price / planId を整合させる
    const planId =
      dto.visibility === Visibility.plan ? dto.planId ?? null : null;
    const priceJpy =
      dto.visibility === Visibility.paid_single ? dto.priceJpy ?? null : null;

    const post = await this.prisma.post.create({
      data: {
        title: dto.title,
        body: dto.body,
        visibility: dto.visibility,
        ageRating: dto.ageRating,
        publishedStatus: pub,
        publishedAt: pubAt,
        creatorId,
        planId,
        priceJpy,
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
