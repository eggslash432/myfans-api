// src/apps/posts/posts.service.ts

import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  Visibility,
  PublishedStatus,
  SubStatus,
  MediaType,
  Role,
} from '@prisma/client';
import { AccessCheckHelper } from '../helpers/access-check.helper';
import { UpdatePostDto } from './dto/update-post.dto';

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

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    const isOfficial = user?.role === Role.admin;    

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
        isOfficial,
      },
    });

    // メディアがある場合まとめて保存
    if (media?.length) {
      await this.prisma.postMedia.createMany({
        data: media.map((m: any, idx: number) => ({
          postId: post.id,
          url: m.url,
          mediaType: m.mediaType as MediaType, // "image" | "video" | "audio" を期待
          sortOrder: idx,
        })),
      });
    }

    return post;
  }

  /**
   * 投稿の詳細取得
   * - 閲覧可能判定つき
   * - 閲覧できなくても 200 で返し、canView=false にする
   */
  async getPostDetail(postId: string, viewerId: string | null) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      include: {
        creator: true,
        media: true,
      },
    });

    if (!post) {
      throw new NotFoundException('投稿が見つかりません');
    }

    let canView = false;

    if (post.visibility === Visibility.free) {
      canView = true;
    } else if (viewerId && post.creatorId === viewerId) {
      canView = true;
    } else if (viewerId && post.visibility === Visibility.plan) {
      const activeSub = await this.prisma.subscription.findFirst({
        where: {
          // viewerId は string | null なので、null のときは undefined にする
          userId: viewerId ?? undefined,
          // post.creatorId も string | null 扱いになっているので同じく
          creatorId: post.creatorId ?? undefined,
          status: SubStatus.active,
          currentPeriodEnd: { gt: new Date() },
        },
      });

      if (activeSub) {
        canView = true;
      }
    } else if (viewerId && post.visibility === Visibility.paid_single) {
      const access = await this.prisma.postAccess.findUnique({
        where: {
          userId_postId: {
            userId: viewerId as string,    // ★ ここもキャスト
            postId,
          },
        },
      });

      if (
        access &&
        (!access.expiresAt || access.expiresAt > new Date())
      ) {
        canView = true;
      }
    }

    return {
      ...post,
      canView,
      isLocked: !canView,
    };
  }


  /**
   * creator の自分の投稿編集
   */
  async updateMyPost(userId: string, postId: string, dto: UpdatePostDto) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
    });

    if (!post || post.creatorId !== userId) {
      // 投稿が存在しない or 他の人の投稿
      throw new ForbiddenException('この投稿は編集できません');
    }

    const nextPublishedStatus =
      dto.publishedStatus ?? post.publishedStatus;

    // publishedAt の扱い
    let nextPublishedAt = post.publishedAt;
    const wasPublished = post.publishedStatus === PublishedStatus.published;
    const willBePublished = nextPublishedStatus === PublishedStatus.published;

    if (!wasPublished && willBePublished) {
      // 初めて公開 → 今の時間
      nextPublishedAt = new Date();
    } else if (wasPublished && !willBePublished) {
      // 公開→下書き/非公開に戻した → null でもOK（仕様に合わせて）
      nextPublishedAt = null;
    }

    const data: any = {};

    if (dto.title !== undefined) data.title = dto.title;
    if (dto.body !== undefined) data.body = dto.body;
    if (dto.visibility !== undefined) data.visibility = dto.visibility;

    if (dto.priceJpy !== undefined) {
      data.priceJpy = dto.priceJpy;
    }

    if (dto.publishedStatus !== undefined) {
      data.publishedStatus = nextPublishedStatus;
      data.publishedAt = nextPublishedAt;
    }

    const updated = await this.prisma.post.update({
      where: { id: postId },
      data,
      select: {
        id: true,
        title: true,
        body: true,
        visibility: true,
        priceJpy: true,
        publishedStatus: true,
        publishedAt: true,
        createdAt: true,
      },
    });

    return updated;
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

    // mimetype から MediaType を判定（image / video / audio）
    await this.prisma.postMedia.createMany({
      data: files.map((f, idx) => {
        const mime = f.mimetype ?? '';
        let mediaType: MediaType;

        if (mime.startsWith('video/')) {
          mediaType = MediaType.video;
        } else if (mime.startsWith('audio/')) {
          mediaType = MediaType.audio;
        } else {
          mediaType = MediaType.image;
        }

        return {
          postId,
          url: `/uploads/posts/${f.filename}`,
          mediaType,
          sortOrder: idx,
        };
      }),
    });

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
      where: { 
        creatorId: userId,
      },
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

  /**
   * 管理者(運営)の投稿一覧
   * - ホーム画面の「お知らせ」用
   */
  async getAdminPosts(limit = 5) {
    return await this.prisma.post.findMany({
      where: {
        publishedStatus: PublishedStatus.published,
        isOfficial: true,
      },
      orderBy: { publishedAt: 'desc' },
      take: limit,
      include: {
        media: true,
      },
    });
  }
}
