import {
  Controller, Post, Body, UseGuards, Req, BadRequestException, ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePostDto } from './dto/create-post.dto';

@Controller()
export class PostsCreateController {
  constructor(private prisma: PrismaService) {}

  // エイリアス: /posts と /creators/me/posts の両方を受ける
  @UseGuards(JwtAuthGuard)
  @Post('posts')
  async createAtPosts(@Body() dto: CreatePostDto, @Req() req: any) {
    return this.createImpl(dto, req.user?.sub, req.user?.role);
  }

  @UseGuards(JwtAuthGuard)
  @Post('creators/me/posts')
  async createAtCreatorsMe(@Body() dto: CreatePostDto, @Req() req: any) {
    return this.createImpl(dto, req.user?.sub, req.user?.role);
  }

  private async createImpl(dto: CreatePostDto, userId?: string, role?: string) {
    if (!userId) throw new ForbiddenException('ログインが必要です');
    if (role !== 'creator') throw new ForbiddenException('クリエイターのみ投稿できます');

    // 入力バリデーション
    if (!dto.title?.trim()) throw new BadRequestException('title は必須です');
    if (!['free', 'plan', 'paid_single'].includes(dto.visibility)) {
      throw new BadRequestException('visibility が不正です');
    }
    if (dto.visibility === 'plan' && !dto.planId) {
      throw new BadRequestException('planId が必要です');
    }
    if (dto.visibility === 'paid_single') {
      if (dto.priceJpy == null || Number.isNaN(dto.priceJpy)) {
        throw new BadRequestException('priceJpy が必要です');
      }
      if (dto.priceJpy! < 100) {
        throw new BadRequestException('priceJpy は100円以上にしてください');
      }
    }

    const isDraft = !!dto.status;
    const now = new Date();

    // Post 作成
    const post = await this.prisma.post.create({
      data: {
        creatorId: userId,
        title: dto.title,
        bodyMd: dto.body ?? null,
        visibility: dto.visibility as any,
        planId: dto.visibility === 'plan' ? dto.planId! : null,
        priceJpy: dto.visibility === 'paid_single' ? dto.priceJpy! : null,
        isPublished: !isDraft,
        publishedAt: !isDraft ? now : null,
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
