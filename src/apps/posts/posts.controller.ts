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
} from '@nestjs/common';

import { PostsService } from './posts.service';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UserJwt } from 'src/shared/types';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';

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
  // ★ 追加：投稿メディアのアップロード
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
      limits: { fileSize: 20 * 1024 * 1024 }, // 20MB くらいまで
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

    // 投稿の所有者チェックなどは service 側に寄せてもOK
    const items = await this.posts.attachMediaToPost(postId, user.id, files);

    return { ok: true, items };
  }  
}
