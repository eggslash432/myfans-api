// api/src/apps/creators/creators.controller.ts

import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Request,
  Param,
  NotFoundException,
  ForbiddenException,
  UnauthorizedException,
  BadRequestException,
  Req,
  Patch,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';

import { IS_MEDIA_LOCAL } from '../../shared/media-env';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CreatorsService } from './creators.service';
import { CreateCreatorDto } from './dto/create-creator.dto';
import { CreatePostDto } from '../posts/dto/create-post.dto';
import { PublishedStatus, Visibility } from '@prisma/client';
import { UpdateCreatorProfileDto } from './dto/update-creator-profile.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { extname } from 'path';
import { diskStorage, memoryStorage } from 'multer';

// ✅ S3Service は使わない
import { MediaStorageService } from '../storage/media-storage.service';

@Controller('creators')
export class CreatorsController {
  constructor(
    private readonly creatorsService: CreatorsService,
    private readonly prisma: PrismaService,
    private readonly mediaStorage: MediaStorageService,
  ) {}

  /* =====================================================
   * 小ヘルパ
   * ===================================================== */

  private getUserIdOrThrow(req: any): string {
    const userId = String(req?.user?.id ?? '');
    if (!userId) throw new UnauthorizedException('JWTが無効です');
    return userId;
  }

  /** クリエイター登録は必要、approved必須かどうかは呼び出し側で選択 */
  private async getCreatorByUserId(userId: string) {
    return this.prisma.creator.findUnique({
      where: { userId },
      select: { userId: true, approvalStatus: true },
    });
  }

  private async requireCreatorApproved(userId: string) {
    const creator = await this.getCreatorByUserId(userId);
    if (!creator) throw new ForbiddenException('クリエイター登録が必要です');
    if (creator.approvalStatus !== 'approved') {
      throw new ForbiddenException('承認済みクリエイターのみ実行できます');
    }
    return creator; // { id, approvalStatus }
  }

  /* =====================================================
   * 申請・一覧
   * ===================================================== */

  @UseGuards(JwtAuthGuard)
  @Post('apply')
  async applyCreator(@Req() req, @Body() dto: CreateCreatorDto) {
    const userId = this.getUserIdOrThrow(req);
    return this.creatorsService.applyCreator(userId, dto);
  }

  @Get()
  async list() {
    // ✅ User.role は運営専用なので条件から外す
    // ✅ 一般公開されるのは「掲載ON」かつ「承認済み」
    const rows = await this.prisma.creator.findMany({
      where: {
        isListed: true,
        approvalStatus: 'approved',
        user: { isActive: true },
      },
      select: {
        userId: true,
        publicName: true,
        _count: {
          select: {
            posts: { where: { publishedStatus: PublishedStatus.published } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 12,
    });

    return {
      items: rows.map((c) => ({
        id: c.userId, // フロント互換：creatorプロフィールは userId で引いてる前提
        displayName: c.publicName,
        postsCount: c._count.posts ?? 0,
      })),
    };
  }

  /* =====================================================
   * me 系（⚠ 必ず :id より上）
   * ===================================================== */

  @UseGuards(JwtAuthGuard)
  @Get('me')
  getMe(@Req() req) {
    const userId = this.getUserIdOrThrow(req);
    // ✅ fan/creator/admin の Roles は廃止。ログインしていれば参照OKにする
    return this.creatorsService.getMe(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me')
  async updateMe(@Req() req, @Body() dto: UpdateCreatorProfileDto) {
    const userId = this.getUserIdOrThrow(req);

    // ✅ プロフィール更新は「承認済みクリエイターのみ」にする（方針）
    // 未承認でも更新させたいなら requireCreatorApproved を getCreatorByUserId に変える
    await this.requireCreatorApproved(userId);

    return this.creatorsService.updateProfile(userId, dto);
  }

  @Post('me/avatar')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: IS_MEDIA_LOCAL
        ? diskStorage({
            destination: 'uploads/creators',
            filename: (req: any, file, cb) => {
              const ext = extname(file.originalname);
              cb(null, `creator-${req.user.id}-${Date.now()}${ext}`);
            },
          })
        : memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  async uploadAvatar(@UploadedFile() file: any, @Req() req: any) {
    const userId = this.getUserIdOrThrow(req);

    // ✅ クリエイター登録が必要（承認必須にするなら requireCreatorApproved にする）
    const creator = await this.getCreatorByUserId(userId);
    if (!creator) throw new ForbiddenException('クリエイター登録が必要です');

    if (!file) throw new BadRequestException('file is required');

    const avatarUrl = await this.mediaStorage.saveCreatorAvatar({
      userId,
      file,
    });

    await this.creatorsService.updateProfile(userId, { avatarUrl });
    return { url: avatarUrl };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/posts')
  async myPosts(@Req() req: any) {
    const userId = this.getUserIdOrThrow(req);

    // ✅ post.creatorId は creator.id を持つ前提に合わせる
    const creator = await this.getCreatorByUserId(userId);
    if (!creator) throw new ForbiddenException('クリエイター登録が必要です');

    const posts = await this.prisma.post.findMany({
      where: { creatorId: creator.userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        visibility: true,
        priceJpy: true,
        planId: true,
        publishedStatus: true,
        publishedAt: true,
        createdAt: true,
        creatorId: true,
      },
    });

    return { items: posts };
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/posts')
  async createMyPost(@Request() req, @Body() dto: CreatePostDto) {
    const userId = this.getUserIdOrThrow(req);

    // ✅ creator判定は approvalStatus
    const creator = await this.requireCreatorApproved(userId);

    // ✅ 価格/プラン整合性（現行のチェックは間違ってたので修正）
    if (dto.visibility === Visibility.plan) {
      if (!(dto as any).planId) throw new BadRequestException('planId が必要です');
    }
    if (dto.visibility === Visibility.paid_single) {
      if (!dto.priceJpy) throw new BadRequestException('PPV は priceJpy が必要です');
    }
    if (dto.visibility === Visibility.free) {
      // free は planId/price は不要（あっても無視するならここでnull化）
    }

    const statusRaw = String((dto as any).publishedStatus ?? (dto as any).status ?? 'draft');
    const status = statusRaw.toUpperCase();

    const publishedStatus =
      status === 'PUBLISHED'
        ? PublishedStatus.published
        : status === 'PRIVATE'
        ? PublishedStatus.private
        : PublishedStatus.draft;

    const post = await this.prisma.post.create({
      data: {
        // ✅ post.creatorId は creator.id
        creatorId: creator.userId,
        title: dto.title,
        body: dto.body ?? '',
        visibility: dto.visibility as any,
        planId: (dto as any).planId ?? null,
        priceJpy: dto.priceJpy ?? null,
        publishedStatus,
        publishedAt: publishedStatus === PublishedStatus.published ? new Date() : null,
      },
    });

    return post;
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/kyc/start')
  async startKyc(@Req() req: any) {
    const userId = this.getUserIdOrThrow(req);
    // KYC開始も承認済みだけに絞るなら requireCreatorApproved を入れる
    await this.requireCreatorApproved(userId);
    return this.creatorsService.startKyc(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/analytics')
  async getMyAnalytics(@Req() req: any) {
    const userId = this.getUserIdOrThrow(req);
    await this.requireCreatorApproved(userId);
    return this.creatorsService.getMySimpleAnalytics(userId);
  }

  /* =====================================================
   * :id 系（最後）
   * ===================================================== */

  @Get(':id/posts')
  async posts(@Param('id') id: string) {
    // ⚠️ここは id が「userId」で来ているので、creator.id に変換してから検索する必要がある
    const creator = await this.prisma.creator.findUnique({
      where: { userId: id },
      select: { userId: true, approvalStatus: true, isListed: true, user: { select: { isActive: true } } },
    });

    if (!creator || !creator.user.isActive) throw new NotFoundException('クリエイターが見つかりません');
    if (creator.approvalStatus !== 'approved' || !creator.isListed) {
      // 非公開扱い（404でも403でも好み。ここは404に寄せる）
      throw new NotFoundException('クリエイターが見つかりません');
    }

    const posts = await this.prisma.post.findMany({
      where: {
        creatorId: creator.userId,
        publishedStatus: PublishedStatus.published,
      },
      orderBy: { publishedAt: 'desc' },
      take: 20,
    });

    return { items: posts };
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    const c = await this.prisma.creator.findUnique({
      where: { userId: id },
      include: {
        user: { include: { profile: true } },
        plans: { where: { isActive: true } },
      },
    });
    if (!c) throw new NotFoundException('クリエイターが見つかりません');

    // 公開制御（必要なら）
    if (!c.user.isActive || c.approvalStatus !== 'approved' || !c.isListed) {
      throw new NotFoundException('クリエイターが見つかりません');
    }

    return {
      id: c.userId,
      publicName: c.publicName,
      displayName: c.user.profile?.displayName ?? c.publicName,
      bio: c.user.profile?.bio ?? null,
      avatarUrl: c.user.profile?.avatarUrl ?? null,
      plans: c.plans,
    };
  }

  @Post(':creatorId/plans/:planId/checkout')
  async createCheckout(@Param('creatorId') creatorId: string, @Param('planId') planId: string) {
    // creatorId は userId 前提
    return { url: await this.creatorsService.createSubscriptionCheckout(creatorId, planId) };
  }
}
