// api/src/apps/posts/posts.media.controller.ts

import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Param,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Request } from 'express';
import { MediaStorageService } from '../storage/media-storage.service';
import { UserJwt } from 'src/shared/types';

type MediaType = 'image' | 'video' | 'audio';

function assertMediaType(v: any): asserts v is MediaType {
  if (v !== 'image' && v !== 'video' && v !== 'audio') {
    throw new BadRequestException('mediaType は image|video|audio のいずれかです');
  }
}

function isMimeAllowed(mediaType: MediaType, mime: string): boolean {
  if (!mime) return false;
  if (mediaType === 'image') return mime.startsWith('image/');
  if (mediaType === 'video') return mime.startsWith('video/');
  if (mediaType === 'audio') return mime.startsWith('audio/');
  return false;
}

@Controller()
export class PostsMediaController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaStorage: MediaStorageService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Post('posts/:postId/media')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 1024 * 1024 * 1024 }, // 1GB（必要なら mediaType別に下で追加制限）
    }),
  )
  async uploadPostMedia(
    @Param('postId') postId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('mediaType') mediaType: MediaType,
    @Req() req: Request,
  ) {
    const user = (req as any).user as UserJwt | undefined;
    if (!user?.id) throw new ForbiddenException('ログインが必要です');

    if (!file?.buffer) throw new BadRequestException('file がありません');
    assertMediaType(mediaType);

    // 追加の安全策：video以外は上限を下げる（必要なら調整）
    const size = file.size ?? file.buffer.length;
    if (mediaType === 'image' && size > 50 * 1024 * 1024) {
      throw new BadRequestException('画像は最大50MBまでです');
    }
    if (mediaType === 'audio' && size > 200 * 1024 * 1024) {
      throw new BadRequestException('音声は最大200MBまでです');
    }
    // videoは interceptor の 1GB 上限に任せる

    if (!isMimeAllowed(mediaType, file.mimetype)) {
      throw new BadRequestException(
        `mediaType=${mediaType} と content-type=${file.mimetype} が一致しません`,
      );
    }

    // ✅ creator判定は User.role ではなく Creator.approvalStatus
    const creator = await this.prisma.creator.findUnique({
      where: { userId: user.id },
      select: { userId: true, approvalStatus: true },
    });

    if (!creator) {
      throw new ForbiddenException('クリエイター登録が必要です');
    }
    if (creator.approvalStatus !== 'approved') {
      // 中間検収手順でも「admin承認後に表示」が前提 :contentReference[oaicite:0]{index=0}
      throw new ForbiddenException('承認済みクリエイターのみアップロードできます');
    }

    // 投稿の所有者チェック（post.creatorId が creator.id の前提）
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      select: { id: true, creatorId: true },
    });
    if (!post) throw new BadRequestException('指定の投稿は存在しません');

    if (post.creatorId !== creator.userId) {
      throw new ForbiddenException('自分の投稿にのみアップロードできます');
    }

    // S3/CloudFront前提のメディア保存（仕様上もメディア基盤は重要） :contentReference[oaicite:1]{index=1}
    const url = await this.mediaStorage.savePostFileFromBuffer({
      postId,
      buffer: file.buffer,
      originalName: file.originalname,
      contentType: file.mimetype,
    });

    // sortOrder と create は transaction で（同時アップロードに少し強くする）
    const media = await this.prisma.$transaction(async (tx) => {
      const sortOrder = await tx.postMedia.count({ where: { postId } });

      return tx.postMedia.create({
        data: {
          postId,
          mediaType: mediaType as any,
          url,
          sortOrder,
        },
      });
    });

    return media;
  }
}
