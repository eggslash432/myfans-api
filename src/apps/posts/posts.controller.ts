// src/apps/posts/posts.controller.ts

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
} from '@nestjs/common';

import { PostsService } from './posts.service';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

type UserJwt = {
  sub: string;              // userId
  role: 'fan' | 'creator' | 'admin';
  email?: string;
};

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
    if (!user?.sub) {
      throw new ForbiddenException('ログインが必要です');
    }

    const posts = await this.posts.getMyPosts(user.sub);
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
    const viewerId = user?.sub ?? null;

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
    if (!user?.sub) {
      throw new ForbiddenException('ログインが必要です');
    }

    const reason = body.reason ?? '';
    const result = await this.posts.reportPost(user.sub, id, reason);

    return result;
  }
}
