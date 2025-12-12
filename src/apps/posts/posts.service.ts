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
    
    if (user?.role === Role.admin && visibility !== Visibility.free) {
      throw new ForbiddenException('管理者は無料投稿のみ作成できます');
    }    

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
        isOfficial: user?.role === Role.admin,
      },
    });

    // ★ dto.media がある場合（URLを保存するだけ）
    if (media?.length) {
      await this.prisma.postMedia.createMany({
        data: media.map((m: any, idx: number) => ({
          postId: post.id,
          url: m.url,
          mediaType: m.mediaType as MediaType,
          sortOrder: idx,
          isSample: !!m.isSample,
        })),
      });
    }

    return post;
  }

  /**
   * 投稿の詳細取得
   * - 閲覧可能判定つき
   * - 閲覧できなくても 200 で返し、canViewMain=false にする
   * - サンプル動画(isSample=true)はプラン関係なく閲覧可
   */
  async getPostDetail(postId: string, viewerId: string | null) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      include: {
        creator: true,
        media: true, // PostMedia に isSample フィールドがある前提
      },
    });

    if (!post) {
      throw new NotFoundException('投稿が見つかりません');
    }

    // ===== 本編の閲覧可否（canViewMain） =====
    let canViewMain = false;

    if (post.visibility === Visibility.free) {
      // 無料投稿は誰でもOK
      canViewMain = true;
    } else if (viewerId && post.creatorId === viewerId) {
      // 投稿者本人は常に閲覧可
      canViewMain = true;
    } else if (viewerId && post.visibility === Visibility.plan) {
      // プラン限定 → 購読中か？
      const activeSub = await this.prisma.subscription.findFirst({
        where: {
          userId: viewerId ?? undefined,
          creatorId: post.creatorId ?? undefined,
          status: SubStatus.active,
          currentPeriodEnd: { gt: new Date() },
        },
      });

      if (activeSub) {
        canViewMain = true;
      }
    } else if (viewerId && post.visibility === Visibility.paid_single) {
      // PPV → postAccess があるか？
      const access = await this.prisma.postAccess.findUnique({
        where: {
          userId_postId: {
            userId: viewerId as string,
            postId,
          },
        },
      });

      if (
        access &&
        (!access.expiresAt || access.expiresAt > new Date())
      ) {
        canViewMain = true;
      }
    }

    // ===== サンプル動画の閲覧可否（canViewSample） =====
    // 今回の仕様では「サンプル動画が存在すれば、誰でも閲覧可」にする
    const hasSampleMedia = post.media.some((m) => m.isSample === true);
    const canViewSample = hasSampleMedia;

    // フロント用に追加情報を付けて返す
    return {
      ...post,
      // 既存互換
      canView: canViewMain,
      isLocked: !canViewMain,

      // 新しいフラグ
      canViewMain,
      canViewSample,
    };
  }

  /**
   * creator の自分の投稿編集
   */
  async updateMyPost(userId: string, postId: string, dto: UpdatePostDto) {
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
        isOfficial: true,
      },
    });

    if (!post || post.creatorId !== userId) {
      throw new ForbiddenException('この投稿は編集できません');
    }

    const wasPublished = post.publishedStatus === PublishedStatus.published;

    // -----------------------------
    // 公開済みは「本文系だけ」編集可
    // -----------------------------
    const data: any = {};

    if (dto.title !== undefined) data.title = dto.title;
    if (dto.body !== undefined) data.body = dto.body;

    // publishedStatus の変更は許可（必要ならここも制限してOK）
    if (dto.publishedStatus !== undefined) {
      const next = dto.publishedStatus as PublishedStatus;

      // publishedAt の扱い
      let nextPublishedAt = post.publishedAt;
      const willBePublished = next === PublishedStatus.published;

      if (!wasPublished && willBePublished) nextPublishedAt = new Date();
      if (wasPublished && !willBePublished) nextPublishedAt = null;

      data.publishedStatus = next;
      data.publishedAt = nextPublishedAt;
    }

    if (wasPublished) {
      // 公開済みはここで打ち切り（visibility/price/planId は触らせない）
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

    // -----------------------------
    // 下書き/非公開は販売条件も編集可
    // -----------------------------
    if (dto.visibility !== undefined) {
      data.visibility = dto.visibility;
    }

    // visibility/price/planId 整合性チェック
    const nextVisibility = (dto.visibility ?? post.visibility) as Visibility;

    if (nextVisibility === Visibility.plan) {
      const nextPlanId = (dto as any).planId ?? post.planId;
      if (!nextPlanId) {
        throw new ForbiddenException('planId が必要です');
      }
      data.planId = nextPlanId;
      data.priceJpy = null; // plan は price 使わないならクリア
    }

    if (nextVisibility === Visibility.paid_single) {
      const nextPrice = dto.priceJpy ?? post.priceJpy;
      if (!nextPrice) {
        throw new ForbiddenException('価格を設定してください');
      }
      data.priceJpy = nextPrice;
      data.planId = null; // PPV は planId 使わないならクリア
    }

    if (nextVisibility === Visibility.free) {
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
    files: Express.Multer.File[],
    sampleIdx?: number,
  ) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      select: { id: true, creatorId: true },
    });

    if (!post) throw new NotFoundException('投稿が見つかりません');
    if (post.creatorId !== userId) {
      throw new ForbiddenException('自分の投稿のみ編集できます');
    }

    const existingCount = await this.prisma.postMedia.count({
      where: { postId }, // ← ここは postId 引数があるのでOK
    });

    await this.prisma.postMedia.createMany({
      data: files.map((f, idx) => {
        const mime = f.mimetype ?? '';
        const mediaType =
          mime.startsWith('video/') ? MediaType.video :
          mime.startsWith('audio/') ? MediaType.audio :
          MediaType.image;

        return {
          postId,
          url: `/uploads/posts/${f.filename}`,
          mediaType,
          sortOrder: existingCount + idx,
          isSample: sampleIdx === idx,
        };
      }),
    });

    return this.prisma.postMedia.findMany({
      where: { postId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  /**
   * creator の自分の投稿一覧
   */
  async getMyPosts(userId: string, role: Role) {
    const where =
      role === Role.admin
        ? { isOfficial: true }  // ★ admin は運営公式投稿だけ
        : { creatorId: userId }; // ★ creator は自分の投稿

    return await this.prisma.post.findMany({
      where: where,
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
