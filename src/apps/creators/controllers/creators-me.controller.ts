// api/src/apps/creators/controllers/creators-me.controller.ts

import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';

import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { CreatorsService } from '../creators.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateCreatorProfileDto } from '../dto/update-creator-profile.dto';
import { CreatePostDto } from '../../posts/dto/create-post.dto';
import { PublishedStatus, Visibility } from '@prisma/client';

import { FileInterceptor } from '@nestjs/platform-express';
import { extname } from 'path';
import { diskStorage, memoryStorage } from 'multer';

import { IS_MEDIA_LOCAL } from '../../../shared/media-env';
import { MediaStorageService } from '../../storage/media-storage.service';
import { CreatorsControllerHelpers } from './creators.controller-helpers';

@Controller('creators/me')
@UseGuards(JwtAuthGuard)
export class CreatorsMeController {
  constructor(
    private readonly creatorsService: CreatorsService,
    private readonly prisma: PrismaService,
    private readonly mediaStorage: MediaStorageService,
    private readonly helpers: CreatorsControllerHelpers,
  ) {}

  @Get()
  getMe(@Req() req: any) {
    const userId = this.helpers.getUserIdOrThrow(req);
    return this.creatorsService.getMe(userId);
  }

  @Patch()
  async updateMe(@Req() req: any, @Body() dto: UpdateCreatorProfileDto) {
    const userId = this.helpers.getUserIdOrThrow(req);

    // 方針：承認済みのみ
    await this.helpers.requireCreatorApproved(userId);

    return this.creatorsService.updateProfile(userId, dto);
  }

  @Post('avatar')
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
    const userId = this.helpers.getUserIdOrThrow(req);

    const creator = await this.helpers.getCreatorByUserId(userId);
    if (!creator) throw new ForbiddenException('クリエイター登録が必要です');

    if (!file) throw new BadRequestException('file is required');

    const avatarUrl = await this.mediaStorage.saveCreatorAvatar({
      userId,
      file,
    });

    await this.creatorsService.updateProfile(userId, { avatarUrl });
    return { url: avatarUrl };
  }

  @Get('posts')
  async myPosts(@Req() req: any) {
    const userId = this.helpers.getUserIdOrThrow(req);

    const creator = await this.helpers.getCreatorByUserId(userId);
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

  @Post('posts')
  async createMyPost(@Req() req: any, @Body() dto: CreatePostDto) {
    const userId = this.helpers.getUserIdOrThrow(req);
    const creator = await this.helpers.requireCreatorApproved(userId);

    if (dto.visibility === Visibility.plan) {
      if (!(dto as any).planId) throw new BadRequestException('planId が必要です');
    }
    if (dto.visibility === Visibility.paid_single) {
      if (!dto.priceJpy) throw new BadRequestException('PPV は priceJpy が必要です');
    }

    const statusRaw = String(
      (dto as any).publishedStatus ?? (dto as any).status ?? 'draft',
    );
    const status = statusRaw.toUpperCase();

    const publishedStatus =
      status === 'PUBLISHED'
        ? PublishedStatus.published
        : status === 'PRIVATE'
        ? PublishedStatus.private
        : PublishedStatus.draft;

    const post = await this.prisma.post.create({
      data: {
        creatorId: creator.userId,
        title: dto.title,
        body: dto.body ?? '',
        visibility: dto.visibility as any,
        planId: (dto as any).planId ?? null,
        priceJpy: dto.priceJpy ?? null,
        publishedStatus,
        publishedAt:
          publishedStatus === PublishedStatus.published ? new Date() : null,
      },
    });

    return post;
  }

  @Post('kyc/start')
  async startKyc(@Req() req: any) {
    const userId = this.helpers.getUserIdOrThrow(req);
    await this.helpers.requireCreatorApproved(userId);
    return this.creatorsService.startKyc(userId);
  }

  @Get('analytics')
  async getMyAnalytics(@Req() req: any) {
    const userId = this.helpers.getUserIdOrThrow(req);
    await this.helpers.requireCreatorApproved(userId);
    return this.creatorsService.getMySimpleAnalytics(userId);
  }
}
