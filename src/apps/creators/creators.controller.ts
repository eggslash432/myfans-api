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
import { PublishedStatus, Role } from '@prisma/client';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
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
   * 申請・一覧
   * ===================================================== */

  @UseGuards(JwtAuthGuard)
  @Post('apply')
  async applyCreator(@Req() req, @Body() dto: CreateCreatorDto) {
    const userId = req.user.id;
    if (!userId) throw new UnauthorizedException('JWTが無効です');
    return this.creatorsService.applyCreator(userId, dto);
  }

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
            posts: { where: { publishedStatus: PublishedStatus.published } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 12,
    });

    return {
      items: rows.map((c) => ({
        id: c.userId,
        displayName: c.publicName,
        postsCount: c._count.posts ?? 0,
      })),
    };
  }

  /* =====================================================
   * me 系（⚠ 必ず :id より上）
   * ===================================================== */

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.fan, Role.creator, Role.admin)
  @Get('me')
  getMe(@Req() req) {
    const userId = req.user.id;
    if (!userId) throw new UnauthorizedException('JWTが無効です');
    return this.creatorsService.getMe(userId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.creator, Role.admin)
  @Patch('me')
  async updateMe(@Req() req, @Body() dto: UpdateCreatorProfileDto) {
    const userId = req.user.id;
    if (!userId) throw new UnauthorizedException('JWTが無効です');
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
        : memoryStorage(), // ✅ S3 のときは buffer を使う
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  async uploadAvatar(@UploadedFile() file: any, @Req() req: any) {
    const userId = req.user.id;
    if (!file) throw new BadRequestException('file is required');

    // ✅ Controller は “保存先の差” を知らない（MediaStorageService に丸投げ）
    const avatarUrl = await this.mediaStorage.saveCreatorAvatar({
      userId,
      // local: file.path / file.filename がある
      // s3: file.buffer がある
      file,
    });

    await this.creatorsService.updateProfile(userId, { avatarUrl });
    return { url: avatarUrl };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/posts')
  async myPosts(@Req() req: any) {
    const userId = req.user.id;
    if (!userId) throw new UnauthorizedException('JWTが無効です');

    const posts = await this.prisma.post.findMany({
      where: { creatorId: userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        visibility: true,
        priceJpy: true,
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
    const userId = req.user?.id;
    const role = req.user?.role;

    if (!userId) throw new UnauthorizedException('JWTが無効です');
    if (![Role.creator, Role.admin].includes(role)) {
      throw new ForbiddenException('クリエイターのみ投稿可能です');
    }

    const creator = await this.prisma.creator.findUnique({ where: { userId } });
    if (!creator) throw new ForbiddenException('クリエイター登録が必要です');

    if ((dto.visibility === 'plan' || dto.visibility === 'paid_single') && !dto.priceJpy) {
      throw new BadRequestException('有料/PPV は price が必要です');
    }

    const status = String((dto as any).publishedStatus ?? (dto as any).status).toUpperCase();
    const publishedStatus =
      status === 'PUBLISHED'
        ? PublishedStatus.published
        : status === 'PRIVATE'
        ? PublishedStatus.private
        : PublishedStatus.draft;

    const post = await this.prisma.post.create({
      data: {
        creatorId: userId,
        title: dto.title,
        body: dto.body ?? '',
        visibility: dto.visibility,
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
    return this.creatorsService.startKyc(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/analytics')
  async getMyAnalytics(@Req() req: any) {
    return this.creatorsService.getMySimpleAnalytics(req.user.id);
  }

  /* =====================================================
   * :id 系（最後）
   * ===================================================== */

  @Get(':id/posts')
  async posts(@Param('id') id: string) {
    const posts = await this.prisma.post.findMany({
      where: { creatorId: id, publishedStatus: PublishedStatus.published },
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
    return { url: await this.creatorsService.createSubscriptionCheckout(creatorId, planId) };
  }
}
