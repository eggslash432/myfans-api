// src/apps/posts/posts.fetch.controller.ts

import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { AccessCheckHelper } from '../helpers/access-check.helper';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UserJwt } from 'src/shared/types';
import { Role } from '@prisma/client';

@Controller('posts')
export class PostsFetchController {
  constructor(private readonly accessCheckHelper: AccessCheckHelper) {}

  // ログインしていないユーザーも見る可能性があるなら
  // カスタムガード or OptionalGuard を使ってもOK
  @UseGuards(JwtAuthGuard)
  @Get(':id')
  async getPost(@Param('id') id: string, @Req() req: any) {
    const user = req.user as UserJwt | undefined;
    const userId = user?.id ;

    const { post } = await this.accessCheckHelper.assertCanViewPost(
      user
        ? { id: user.id, role: user.role as Role }  // ★ ここ
        : null,
      id,
    );

    // 必要なら canView を返却してフロントで鍵アイコン制御してもOK
    return post;
  }
}
