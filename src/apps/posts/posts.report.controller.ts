// api/src/apps/posts/posts.report.controller.ts
import {
  Body,
  Controller,
  Param,
  Post as HttpPost,
  UseGuards,
  BadRequestException,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateReportDto } from './dto/create-report.dto';
import { UserJwt } from 'src/shared/types';

@Controller('posts')
export class PostsReportController {
  constructor(private readonly prisma: PrismaService) {}

  @UseGuards(JwtAuthGuard)
  @HttpPost(':postId/report')
  async reportPost(
    @Param('postId') postId: string,
    @Body() dto: CreateReportDto,
    @Req() req: Request,
  ) {
    const user = (req as any).user as UserJwt | undefined;
    if (!user?.id) {
      throw new BadRequestException('ユーザー情報を取得できませんでした');
    }

    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      select: { id: true },
    });
    if (!post) {
      throw new BadRequestException('投稿が存在しません');
    }

    const existing = await this.prisma.report.findFirst({
      where: { postId, userId: user.id },
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
        userId: user.id,
        reason: dto.reason,
        status: 'pending', // 明示したいなら
      },
    });
  }
}
