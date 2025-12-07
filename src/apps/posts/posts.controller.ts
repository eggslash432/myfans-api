// api/src/apps/posts/posts.controller.ts

import {
  Controller,
  Get,
  Param,
  Req,
  UseGuards,
  Post as PostMethod,
  Body,
  ForbiddenException,
  NotFoundException,
  UseInterceptors,
  UploadedFiles,
  Patch,
  UnauthorizedException,
} from '@nestjs/common';

import { PostsService } from './posts.service';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UserJwt } from 'src/shared/types';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import sharp from 'sharp';
import { promises as fs } from 'fs';
import { UpdatePostDto } from './dto/update-post.dto';

@Controller('posts')
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  /**
   * 公開フィード
   * - トップページ等からの一覧取得用
   * - free / plan / paid_single をまとめて返す（本文は含めない前提）
   */
  @Get()
  async listPublicPosts() {
    const items = await this.posts.getPublicFeed();
    return { items };
  }

  /**
   * 自分の投稿一覧（クリエイター用）
   * - 要ログイン
   */
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async myPosts(@Req() req: any) {
    const user = req.user as UserJwt | undefined;
    if (!user?.id) {
      throw new ForbiddenException('ログインが必要です');
    }

    const posts = await this.posts.getMyPosts(user.id);
    return { items: posts };
  }

  /**
   * 投稿詳細
   * - free は誰でも閲覧可
   * - plan / paid_single は購読 / PPV 購入しているユーザーのみ本文閲覧可
   * - 投稿者本人は常に閲覧可
   */
  @UseGuards(OptionalJwtAuthGuard)
  @Get(':id')
  async getPost(@Param('id') id: string, @Req() req: any) {
    const user = req.user as UserJwt | undefined;
    const viewerId = user?.id ?? null;

    const detail = await this.posts.getPostDetail(id, viewerId);
    if (!detail) {
      throw new NotFoundException('投稿が見つかりません');
    }

    return detail;
  }

  /**
   * 投稿を通報
   */
  @UseGuards(JwtAuthGuard)
  @PostMethod(':id/report')
  async reportPost(
    @Param('id') id: string,
    @Body() body: { reason?: string },
    @Req() req: any,
  ) {
    const user = req.user as UserJwt | undefined;
    if (!user?.id) {
      throw new ForbiddenException('ログインが必要です');
    }

    const reason = body.reason ?? '';
    const result = await this.posts.reportPost(user.id, id, reason);

    return result;
  }

  // --------------------------------------------------
  // ★ 投稿メディアのアップロード
  // POST /posts/:id/media
  // --------------------------------------------------
  @UseGuards(JwtAuthGuard)
  @PostMethod(':id/media')
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      storage: diskStorage({
        destination: 'uploads/posts',
        filename: (req, file, cb) => {
          const ext = extname(file.originalname);
          const name = `post-${req.params.id}-${Date.now()}${ext}`;
          cb(null, name);
        },
      }),
      limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
    }),
  )
  async uploadMedia(
    @Param('id') postId: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Req() req: any,
  ) {
    const user = req.user as UserJwt | undefined;
    if (!user?.id) {
      throw new ForbiddenException('ログインが必要です');
    }

    // ★ 画像ファイルだけリサイズ（動画などはそのまま）
    await Promise.all(
      (files ?? [])
        .filter((f) => f.mimetype.startsWith('image/'))
        .map(async (file) => {
          // diskStorage なので file.path に保存済み
          const inputPath = file.path;
          const tmpPath = `${inputPath}.tmp`;

          // 元のフォーマットを保ったままリサイズ
          const img = sharp(inputPath);
          const meta = await img.metadata();
          const format =
            meta.format ??
            (file.mimetype.includes('png')
              ? 'png'
              : 'jpeg');

          const pipeline = img.resize({
            width: 1280,          // 最大 1280px
            height: 1280,
            fit: 'inside',        // 枠内に収める（アスペクト比維持）
            withoutEnlargement: true, // 小さい画像は拡大しない
          });

          if (format === 'jpeg' || format === 'jpg') {
            await pipeline.jpeg({ quality: 80 }).toFile(tmpPath);
          } else if (format === 'png') {
            await pipeline.png({ compressionLevel: 8 }).toFile(tmpPath);
          } else {
            await pipeline.toFile(tmpPath);
          }

          // ★ 変換が終わったら元のファイルと置き換え
          await fs.rename(tmpPath, inputPath);
        }),
    );

    // ここまで来た時点で、画像はすべて「最大1280px」程度に縮小されている
    const items = await this.posts.attachMediaToPost(postId, user.id, files);

    return { ok: true, items };
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me/:id')
  async updateMyPost(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdatePostDto,
  ) {
    const userId: string | undefined = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException('JWTが無効です');
    }
    return this.posts.updateMyPost(userId, id, dto);
  }  
}
