// src/apps/posts/posts.service.ts

import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  Visibility,
  PublishedStatus,
  SubStatus,
  MediaType,
} from '@prisma/client';
import { AccessCheckHelper } from '../helpers/access-check.helper';

@Injectable()
export class PostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessHelper: AccessCheckHelper,
  ) {}

  /**
   * 投稿を作成
   */
  async createPost(userId: string, dto: any) {
    const { title, body, visibility, planId, priceJpy, media } = dto;

    // plan投稿なのにplanIdがない → エラー
    if (visibility === Visibility.plan && !planId) {
      throw new ForbiddenException('planId が必要です');
    }

    // PPV なのに price がない → エラー
    if (visibility === Visibility.paid_single && !priceJpy) {
      throw new ForbiddenException('価格を設定してください');
    }

    const post = await this.prisma.post.create({
      data: {
        creatorId: userId,
        title,
        body,
        visibility,
        planId: planId || null,
        priceJpy: priceJpy || null,
        publishedStatus: PublishedStatus.published,
      },
    });

    // メディアがある場合まとめて保存
    if (media?.length) {
      await this.prisma.postMedia.createMany({
        data: media.map((m: any, idx: number) => ({
          postId: post.id,
          url: m.url,
          mediaType: m.mediaType,
          sortOrder: idx,
        })),
      });
    }

    return post;
  }

  /**
   * 投稿の詳細取得
   * - 閲覧可能判定つき
   */
  async getPostDetail(postId: string, viewerId: string | null) {
    const result = await this.accessHelper.assertCanViewPost(viewerId, postId);

    const { post } = result;
    return {
      ...post,
      canView: true,
    };
  }

  /**
   * 投稿を編集（必要なら）
   */
  async updatePost(userId: string, postId: string, dto: any) {
    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    if (!post) throw new NotFoundException('投稿が見つかりません');

    if (post.creatorId !== userId) {
      throw new ForbiddenException('自分の投稿のみ編集できます');
    }

    return await this.prisma.post.update({
      where: { id: postId },
      data: {
        title: dto.title ?? post.title,
        body: dto.body ?? post.body,
        visibility: dto.visibility ?? post.visibility,
        planId: dto.planId ?? post.planId,
        priceJpy: dto.priceJpy ?? post.priceJpy,
      },
    });
  }

  async attachMediaToPost(
    postId: string,
    userId: string,
    files: Express.Multer.File[],
  ) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      select: { id: true, creatorId: true },
    });

    if (!post) {
      throw new NotFoundException('投稿が見つかりません');
    }
    if (post.creatorId !== userId) {
      throw new ForbiddenException('自分の投稿のみ編集できます');
    }

    // ★ mediaAsset → postMedia に修正
    await this.prisma.postMedia.createMany({
      data: files.map((f, idx) => ({
        postId,
        url: `/uploads/posts/${f.filename}`,
        mediaType: f.mimetype.startsWith('video/')
          ? MediaType.video
          : MediaType.image,
        sortOrder: idx,
      })),
    });

    // ★ こちらも postMedia に修正
    const created = await this.prisma.postMedia.findMany({
      where: { postId },
      orderBy: { sortOrder: 'asc' },
    });

    return created;
  }  

  /**
   * creator の自分の投稿一覧
   */
  async getMyPosts(userId: string) {
    return await this.prisma.post.findMany({
      where: { creatorId: userId },
      orderBy: { createdAt: 'desc' },
      include: {
        media: true,
        _count: {
          select: {
            postAccesses: true,
            reports: true,
          },
        },
      },
    });
  }

  /**
   * 公開フィード一覧
   * - free, plan, ppv を一覧で返す
   * - plan / paid_single は本文なし・メディア一部だけ
   */
  async getPublicFeed() {
    return await this.prisma.post.findMany({
      where: {
        publishedStatus: PublishedStatus.published,
      },
      orderBy: { publishedAt: 'desc' },
      include: {
        creator: {
          select: {
            publicName: true,
          },
        },
        media: true,
      },
    });
  }

  /**
   * 投稿通報
   */
  async reportPost(userId: string, postId: string, reason: string) {
    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    if (!post) throw new NotFoundException('投稿が見つかりません');

    await this.prisma.report.create({
      data: {
        postId,
        userId,
        reason,
      },
    });

    return { ok: true };
  }
}
