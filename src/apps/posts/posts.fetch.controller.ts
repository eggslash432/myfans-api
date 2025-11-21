// src/apps/posts/posts.fetch.controller.ts

import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { AccessCheckHelper } from '../helpers/access-check.helper';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('posts')
export class PostsFetchController {
  constructor(private readonly accessHelper: AccessCheckHelper) {}

  // ログインしていないユーザーも見る可能性があるなら
  // カスタムガード or OptionalGuard を使ってもOK
  @UseGuards(JwtAuthGuard)
  @Get(':id')
  async getPost(@Param('id') id: string, @Req() req: any) {
    const user = req.user as { sub: string } | undefined;
    const userId = user?.sub ?? null;

    const { post } = await this.accessHelper.assertCanViewPost(userId, id);

    // 必要なら canView を返却してフロントで鍵アイコン制御してもOK
    return post;
  }
}
