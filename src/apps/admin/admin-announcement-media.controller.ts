// api/src/apps/admin/admin-announcements-media.controller.ts
import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminOnlyGuard } from '../access-control/admin-only.guard';
import { MediaStorageService } from '../storage/media-storage.service';
import { IS_MEDIA_LOCAL } from '../../shared/media-env';

import { diskStorage, memoryStorage } from 'multer';
import { extname } from 'path';
import { existsSync, mkdirSync } from 'fs';

function ensureTmpDir() {
  const dir = 'uploads/tmp';
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function multerOptionsForEnv() {
  if (IS_MEDIA_LOCAL) {
    const destination = ensureTmpDir();
    return {
      storage: diskStorage({
        destination,
        filename: (_req, file, cb) => {
          const safeExt = extname(file.originalname || '') || '';
          const uniq = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          cb(null, `${uniq}${safeExt}`);
        },
      }),
      limits: { fileSize: 200 * 1024 * 1024 }, // 任意
    };
  }
  // s3/buffer
  return {
    storage: memoryStorage(),
    limits: { fileSize: 200 * 1024 * 1024 }, // 任意
  };
}

@UseGuards(JwtAuthGuard, AdminOnlyGuard)
@Controller('admin/announcements')
export class AdminAnnouncementsMediaController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: MediaStorageService,
  ) {}

  @Post(':id/media')
  @UseInterceptors(FilesInterceptor('files', 10, multerOptionsForEnv()))
  async upload(@Param('id') id: string, @UploadedFiles() files: any[]) {
    const announcementId = Number(id);
    if (!Number.isFinite(announcementId)) throw new BadRequestException('invalid id');
    if (!files?.length) throw new BadRequestException('files required');

    // sortOrder を末尾に追加
    const last = await this.prisma.announcementMedia.findFirst({
      where: { announcementId },
      orderBy: { sortOrder: 'desc' },
    });
    let sortOrder = (last?.sortOrder ?? 0) + 1;

    const urls = await Promise.all(
      files.map(async (file) => {
        const originalName = file.originalname || 'file.bin';
        const contentType = file.mimetype || 'application/octet-stream';

        // local: diskStorage -> file.path
        if (IS_MEDIA_LOCAL) {
          if (!file.path) {
            // ここに来たらインターセプタ設定が効いてない
            throw new BadRequestException('local upload expects diskStorage file.path');
          }
          return this.storage.saveAnnouncementFileFromTemp({
            announcementId: String(announcementId),
            tmpPath: file.path,
            originalName,
            contentType,
          });
        }

        // s3: memoryStorage -> file.buffer
        if (!file.buffer) throw new BadRequestException('s3 upload expects memoryStorage file.buffer');
        return this.storage.saveAnnouncementFileFromBuffer({
          announcementId: String(announcementId),
          buffer: file.buffer,
          originalName,
          contentType,
        });
      }),
    );

    const items = await this.prisma.$transaction(
      urls.map((url, i) =>
        this.prisma.announcementMedia.create({
          data: {
            announcementId,
            url,
            mediaType: (files[i]?.mimetype || '').startsWith('video/') ? 'video' : 'image',
            sortOrder: sortOrder++,
          },
        }),
      ),
    );

    return { items };
  }

  @Get(':id/media')
  async list(@Param('id') id: string) {
    const announcementId = Number(id);
    if (!Number.isFinite(announcementId)) throw new BadRequestException('invalid id');

    const items = await this.prisma.announcementMedia.findMany({
      where: { announcementId },
      orderBy: { sortOrder: 'asc' },
    });

    return { items };
  }
}
