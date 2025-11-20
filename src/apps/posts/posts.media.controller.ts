// src/apps/posts/posts.media.controller.ts
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
import { S3Service } from '../s3/s3.service'; // パスは実プロジェクトに合わせて
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

type UserJwt = {
  sub: string;
  role: 'fan' | 'creator' | 'admin';
  email?: string;
};

@Controller()
export class PostsMediaController {
  constructor(
    private prisma: PrismaService,
    private s3Service: S3Service,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Post('posts/:postId/media')
  @UseInterceptors(FileInterceptor('file'))
  async uploadPostMedia(
    @Param('postId') postId: string,
    @UploadedFile() file: any, // 型は一旦 any でOK（前の話の通り）
    @Body('mediaType') mediaType: 'image' | 'video' | 'audio',
    @Req() req: any,
  ) {
    const user = req.user as UserJwt | undefined;
    if (!user) throw new ForbiddenException('ログインが必要です');
    if (user.role !== 'creator') {
      throw new ForbiddenException('クリエイターのみアップロードできます');
    }

    if (!file) {
      throw new BadRequestException('file がありません');
    }
    if (!mediaType) {
      throw new BadRequestException('mediaType が必要です');
    }

    // 自分の投稿かチェック
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      select: { id: true, creatorId: true },
    });
    if (!post) throw new BadRequestException('指定の投稿は存在しません');
    if (post.creatorId !== user.sub) {
      throw new ForbiddenException('自分の投稿にのみアップロードできます');
    }

    // ★ ここで local / s3 を切り替え
    const driver = (process.env.MEDIA_DRIVER || 'local').toLowerCase();
    let url: string;

    if (driver === 'local') {
      // ---- ローカル保存 ----
      const uploadsRoot = path.join(process.cwd(), 'uploads');
      if (!fs.existsSync(uploadsRoot)) {
        fs.mkdirSync(uploadsRoot, { recursive: true });
      }

      const postDir = path.join(uploadsRoot, postId);
      if (!fs.existsSync(postDir)) {
        fs.mkdirSync(postDir, { recursive: true });
      }

      const ext = file.originalname?.split('.').pop() || 'bin';
      const filename = `${randomUUID()}.${ext}`;
      const filepath = path.join(postDir, filename);

      fs.writeFileSync(filepath, file.buffer);

      // ローカルで参照するURL（後で main.ts の static 設定と合わせる）
      const base = (process.env.LOCAL_MEDIA_BASE_URL || 'http://localhost:3000')
        .replace(/\/+$/, '');
      url = `${base}/uploads/${postId}/${filename}`;
    } else {
      // ---- S3 保存 ----
      url = await this.s3Service.uploadPostFileBuffer({
        postId,
        fileName: file.originalname,
        contentType: file.mimetype,
        buffer: file.buffer,
      });
    }

    // sortOrder は既存枚数をベースに採番
    const sortOrder = await this.prisma.postMedia.count({
      where: { postId },
    });

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
