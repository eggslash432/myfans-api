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
import { UserJwt } from 'src/shared/types';

// ✅ S3Service は使わない
import { MediaStorageService } from '../storage/media-storage.service';

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
      storage: memoryStorage(), // ✅ bufferで統一
      limits: { fileSize: 1024 * 1024 * 1024 },
    }),
  )
  async uploadPostMedia(
    @Param('postId') postId: string,
    @UploadedFile() file: any,
    @Body('mediaType') mediaType: 'image' | 'video' | 'audio',
    @Req() req: any,
  ) {
    const user = req.user as UserJwt | undefined;
    if (!user) throw new ForbiddenException('ログインが必要です');
    if (user.role !== 'creator') throw new ForbiddenException('クリエイターのみアップロードできます');

    if (!file?.buffer) throw new BadRequestException('file がありません');
    if (!mediaType) throw new BadRequestException('mediaType が必要です');

    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      select: { id: true, creatorId: true },
    });
    if (!post) throw new BadRequestException('指定の投稿は存在しません');
    if (post.creatorId !== user.id) throw new ForbiddenException('自分の投稿にのみアップロードできます');

    const url = await this.mediaStorage.savePostFileFromBuffer({
      postId,
      buffer: file.buffer,
      originalName: file.originalname,
      contentType: file.mimetype,
    });

    const sortOrder = await this.prisma.postMedia.count({ where: { postId } });

    const media = await this.prisma.postMedia.create({
      data: {
        postId,
        mediaType: mediaType as any,
        url,
        sortOrder,
      },
    });

    return media;
  }
}
