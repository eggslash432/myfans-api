// src/apps/posts/posts.report.controller.ts
import {
  Body,
  Controller,
  Param,
  Post as HttpPost,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateReportDto } from './dto/create-report.dto';

type UserJwt = {
  sub: string; // userId
  role: 'fan' | 'creator' | 'admin';
};

@Controller('posts')
export class PostsReportController {
  constructor(private readonly prisma: PrismaService) {}

  @UseGuards(JwtAuthGuard)
  @HttpPost(':postId/report')
  async reportPost(
    @Param('postId') postId: string,
    @Body() dto: CreateReportDto,
    req: any,
  ) {
    const user = req.user as UserJwt | undefined;
    if (!user) {
      throw new BadRequestException('ユーザー情報を取得できませんでした');
    }

    // 対象投稿が存在するか簡易チェック
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      select: { id: true },
    });
    if (!post) {
      throw new BadRequestException('投稿が存在しません');
    }

    // 既に同じユーザーが同じ投稿を通報していたら、二重通報防止のため status を pending に戻す
    const existing = await this.prisma.report.findFirst({
      where: { postId, userId: user.sub },
    });

    if (existing) {
      return this.prisma.report.update({
        where: { id: existing.id },
        data: {
          reason: dto.reason,
          status: 'pending',
        },
      });
    }

    return this.prisma.report.create({
      data: {
        postId,
        userId: user.sub,
        reason: dto.reason,
      },
    });
  }
}
