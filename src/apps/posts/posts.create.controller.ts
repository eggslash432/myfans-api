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
import { PostPublishedStatus, Role, PostVisibility, CreatorApprovalStatus } from '@prisma/client';
import { UserJwt } from 'src/shared/types';
import { CreatorHelper } from '../helpers/creator.helper';

@Controller()
export class PostsCreateController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly creatorHelper: CreatorHelper,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Post('posts')
  async createAtPosts(@Body() dto: CreatePostDto, @Req() req: any) {
    return this.createImpl(dto, req);
  }

  @UseGuards(JwtAuthGuard)
  @Post('creators/me/posts')
  async createAtCreatorsMe(@Body() dto: CreatePostDto, @Req() req: any) {
    return this.createImpl(dto, req);
  }

  private async createImpl(dto: CreatePostDto, req: any) {
    const user = req.user as UserJwt | undefined;
    if (!user?.id) throw new UnauthorizedException('ログインが必要です');

    // ✅ 運営判定（User.role は運営専用）
    const isAdmin = user.role === Role.admin || user.role === Role.sub_admin;

    // ✅ クリエイター判定（roleは見ない：Creator approved を見る）
    const creator = await this.prisma.creator.findUnique({
      where: { userId: user.id }, // userId が unique / id 想定
      select: { userId: true, approvalStatus: true },
    });

    const isApprovedCreator =
      !!creator && creator.approvalStatus === CreatorApprovalStatus.approved;

    if (!isAdmin && !isApprovedCreator) {
      throw new ForbiddenException('承認済みクリエイターのみ投稿できます');
    }

    // ✅ creatorId（運営投稿は null、クリエイター投稿は紐付け）
    const creatorId: string | null = isAdmin ? null : creator!.userId;

    // 🔥 運営投稿は無料固定
    const visibility: PostVisibility = isAdmin ? PostVisibility.free : dto.visibility;

    const planId: string | null =
      isAdmin
        ? null
        : dto.visibility === PostVisibility.plan
        ? dto.planId ?? null
        : null;

    const priceJpy: number | null =
      isAdmin
        ? null
        : dto.visibility === PostVisibility.paid_single
        ? dto.priceJpy ?? null
        : null;

    const toPublishedStatus = (v: unknown): PostPublishedStatus => {
      if (typeof v === 'boolean') {
        return v ? PostPublishedStatus.published : PostPublishedStatus.draft;
      }
      if (typeof v === 'string') {
        const s = v.toLowerCase();
        if (s === 'published') return PostPublishedStatus.published;
        if (s === 'private') return PostPublishedStatus.private;
        return PostPublishedStatus.draft;
      }
      return PostPublishedStatus.draft;
    };

    const pub = toPublishedStatus(
      (dto as any).publishedStatus ?? (dto as any).status,
    );
    const pubAt = pub === PostPublishedStatus.published ? new Date() : null;

    const post = await this.prisma.post.create({
      data: {
        title: dto.title,
        body: dto.body,
        ageRating: dto.ageRating,

        visibility,
        planId,
        priceJpy,

        creatorId,

        publishedStatus: pub,
        publishedAt: pubAt,

        isOfficial: isAdmin,
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
