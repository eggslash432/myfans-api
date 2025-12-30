// api/src/apps/posts/posts.edit.service.ts

import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MediaType, PostPublishedStatus, PostVisibility } from '@prisma/client';
import { UpdatePostDto } from './dto/update-post.dto';
import { getCreatorByUserIdOrThrow } from './posts.authz';

@Injectable()
export class PostsEditService {
  constructor(private readonly prisma: PrismaService) {}

  private async getMyCreatorId(userId: string) {
    const creator = await getCreatorByUserIdOrThrow(this.prisma, userId, { requireApproved: false });
    return creator.userId;
  }

  /**
   * creator の自分の投稿編集
   */
  async updateMyPost(userId: string, postId: string, dto: UpdatePostDto) {
    const myCreatorId = await this.getMyCreatorId(userId);

    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      select: {
        id: true,
        creatorId: true,
        visibility: true,
        planId: true,
        priceJpy: true,
        publishedStatus: true,
        publishedAt: true,
      },
    });

    if (!post) throw new NotFoundException('投稿が見つかりません');
    if (post.creatorId !== myCreatorId) throw new ForbiddenException('この投稿は編集できません');

    const wasPublished = post.publishedStatus === PostPublishedStatus.published;

    const data: any = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.body !== undefined) data.body = dto.body;

    if (dto.publishedStatus !== undefined) {
      const next = dto.publishedStatus as PostPublishedStatus;

      let nextPublishedAt = post.publishedAt;
      const willBePublished = next === PostPublishedStatus.published;

      if (!wasPublished && willBePublished) nextPublishedAt = new Date();
      if (wasPublished && !willBePublished) nextPublishedAt = null;

      data.publishedStatus = next;
      data.publishedAt = nextPublishedAt;
    }

    if (wasPublished) {
      return await this.prisma.post.update({
        where: { id: postId },
        data,
        select: {
          id: true,
          title: true,
          body: true,
          visibility: true,
          planId: true,
          priceJpy: true,
          publishedStatus: true,
          publishedAt: true,
          createdAt: true,
        },
      });
    }

    // 下書き/非公開は販売条件も編集可
    if (dto.visibility !== undefined) data.visibility = dto.visibility;

    const nextVisibility = (dto.visibility ?? post.visibility) as PostVisibility;

    if (nextVisibility === PostVisibility.plan) {
      const nextPlanId = (dto as any).planId ?? post.planId;
      if (!nextPlanId) throw new ForbiddenException('planId が必要です');
      data.planId = nextPlanId;
      data.priceJpy = null;
    }

    if (nextVisibility === PostVisibility.paid_single) {
      const nextPrice = dto.priceJpy ?? post.priceJpy;
      if (!nextPrice) throw new ForbiddenException('価格を設定してください');
      data.priceJpy = nextPrice;
      data.planId = null;
    }

    if (nextVisibility === PostVisibility.free) {
      data.planId = null;
      data.priceJpy = null;
    }

    return await this.prisma.post.update({
      where: { id: postId },
      data,
      select: {
        id: true,
        title: true,
        body: true,
        visibility: true,
        planId: true,
        priceJpy: true,
        publishedStatus: true,
        publishedAt: true,
        createdAt: true,
      },
    });
  }

  async attachMediaToPost(
    postId: string,
    userId: string,
    media: Array<{
      url: string;
      mime?: string;
      mimetype?: string;
      contentType?: string;
      originalName?: string;
    }>,
    sampleIdx?: number,
  ) {
    const myCreatorId = await this.getMyCreatorId(userId);

    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      select: { id: true, creatorId: true },
    });

    if (!post) throw new NotFoundException('投稿が見つかりません');
    if (post.creatorId !== myCreatorId) throw new ForbiddenException('自分の投稿のみ編集できます');

    const existingCount = await this.prisma.postMedia.count({ where: { postId } });

    const guessMediaType = (url: string, mime?: string) => {
      const m = (mime ?? '').toLowerCase();
      if (m.startsWith('video/')) return MediaType.video;
      if (m.startsWith('audio/')) return MediaType.audio;
      if (m.startsWith('image/')) return MediaType.image;

      const lower = (url ?? '').toLowerCase();
      if (lower.match(/\.(mp4|mov|webm|m4v)(\?|#|$)/)) return MediaType.video;
      if (lower.match(/\.(mp3|wav|m4a|aac|ogg)(\?|#|$)/)) return MediaType.audio;
      if (lower.match(/\.(png|jpe?g|gif|webp|avif)(\?|#|$)/)) return MediaType.image;

      return MediaType.image;
    };

    const rows = (media ?? [])
      .filter((m) => !!m?.url)
      .map((m, idx) => {
        const mime = m.mime ?? m.mimetype ?? m.contentType ?? '';
        return {
          postId,
          url: m.url,
          mediaType: guessMediaType(m.url, mime),
          sortOrder: existingCount + idx,
          isSample: sampleIdx === idx,
        };
      });

    if (rows.length) {
      await this.prisma.postMedia.createMany({ data: rows });
    }

    return this.prisma.postMedia.findMany({
      where: { postId },
      orderBy: { sortOrder: 'asc' },
    });
  }
}
