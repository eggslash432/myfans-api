// api/src/apps/creators/controllers/creators-public.controller.ts

import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PublishedStatus } from '@prisma/client';

@Controller('creators')
export class CreatorsPublicController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list() {
    const rows = await this.prisma.creator.findMany({
      where: {
        isListed: true,
        approvalStatus: 'approved',
        user: { isActive: true },
      },
      select: {
        userId: true,
        publicName: true,
        _count: {
          select: {
            posts: { where: { publishedStatus: PublishedStatus.published } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 12,
    });

    return {
      items: rows.map((c) => ({
        id: c.userId,
        displayName: c.publicName,
        postsCount: c._count.posts ?? 0,
      })),
    };
  }

  @Get(':id/posts')
  async posts(@Param('id') id: string) {
    const creator = await this.prisma.creator.findUnique({
      where: { userId: id },
      select: {
        userId: true,
        approvalStatus: true,
        isListed: true,
        user: { select: { isActive: true } },
      },
    });

    if (!creator || !creator.user.isActive) {
      throw new NotFoundException('クリエイターが見つかりません');
    }
    if (creator.approvalStatus !== 'approved' || !creator.isListed) {
      throw new NotFoundException('クリエイターが見つかりません');
    }

    const posts = await this.prisma.post.findMany({
      where: {
        creatorId: creator.userId,
        publishedStatus: PublishedStatus.published,
      },
      orderBy: { publishedAt: 'desc' },
      take: 20,
    });

    return { items: posts };
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    const c = await this.prisma.creator.findUnique({
      where: { userId: id },
      include: {
        user: { include: { profile: true } },
        plans: { where: { isActive: true } },
      },
    });
    if (!c) throw new NotFoundException('クリエイターが見つかりません');

    if (!c.user.isActive || c.approvalStatus !== 'approved' || !c.isListed) {
      throw new NotFoundException('クリエイターが見つかりません');
    }

    return {
      id: c.userId,
      publicName: c.publicName,
      displayName: c.user.profile?.displayName ?? c.publicName,
      bio: c.user.profile?.bio ?? null,
      avatarUrl: c.user.profile?.avatarUrl ?? null,
      plans: c.plans,
    };
  }
}
