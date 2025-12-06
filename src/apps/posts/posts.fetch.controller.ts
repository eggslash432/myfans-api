// src/apps/posts/posts.fetch.controller.ts

import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { AccessCheckHelper } from '../helpers/access-check.helper';
import { UserJwt } from 'src/shared/types';
import { Role } from '@prisma/client';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';

@Controller('posts')
export class PostsFetchController {
  constructor(private readonly accessCheckHelper: AccessCheckHelper) {}

  // ログインしていないユーザーも見る可能性があるなら
  // カスタムガード or OptionalGuard を使ってもOK
  @UseGuards(OptionalJwtAuthGuard)
  @Get(':id')
  async getPost(@Param('id') id: string, @Req() req: any) {
    const user = req.user as UserJwt | undefined;
    
    const { post, canView } =
      await this.accessCheckHelper.assertCanViewPost(
        user ? user.id : null,
        id,
      );

    // ★ Post 本体に canView をマージして返す
    return {
      ...post,
      canView,
    };
  }
}
