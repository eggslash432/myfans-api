// api/src/apps/helpers/access-check.helper.ts
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MediaType, Visibility } from '@prisma/client';

@Injectable()
export class AccessCheckHelper {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 閲覧可能かどうかを判定
   * - free → 誰でもOK
   * - 自分の投稿 → OK
   * - plan / paid_single → postAccess にレコードがあるか？
   */
  async assertCanViewPost(viewerId: string | null, postId: string) {
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

    // 1. free は誰でも読める
    if (post.visibility === Visibility.free) {
      return { post, canView: true };
    }

    // 2. 未ログインはここから先は読めない
    if (!viewerId) {
      throw new ForbiddenException('ログインが必要です');
    }

    // 3. 自分の投稿は必ず読める
    if (post.creatorId === viewerId) {
      return { post, canView: true };
    }

    // 4. 共通の PostAccess チェック（プランも PPV もここ）
    const access = await this.prisma.postAccess.findUnique({
      where: {
        userId_postId: {
          userId: viewerId,
          postId,
        },
      },
    });

    const expired =
      access?.expiresAt && access.expiresAt <= new Date();

    if (!access || expired) {
      if (post.visibility === Visibility.plan) {
        throw new ForbiddenException('プラン購読が必要です');
      }
      if (post.visibility === Visibility.paid_single) {
        throw new ForbiddenException('PPV購入が必要です');
      }
      throw new ForbiddenException('閲覧権限がありません');
    }

    // ここまで来たら閲覧OK
    return { post, canView: true };
  }

    /**
   * 投稿＋本編閲覧可否＋サンプル閲覧可否をまとめて返す
   * - canViewMain : 今までのロジック
   * - canViewSample: サンプル動画があれば true（誰でもOK）
   */
  async getPostAccess(viewerId: string | null, postId: string) {
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

    // サンプル動画があるかどうか（誰でも閲覧可）
    const sampleMedia = post.media.find(
      (m) => m.isSample && m.mediaType === MediaType.video,
    );
    const canViewSample = !!sampleMedia;

    // 本編の閲覧可否（例外を投げずにフラグで返したいのでロジックをコピー）
    let canViewMain = false;

    // free は誰でもOK
    if (post.visibility === Visibility.free) {
      canViewMain = true;
    } else if (!viewerId) {
      // 未ログインで有料 → canViewMain = false のまま
      canViewMain = false;
    } else if (post.creatorId === viewerId) {
      // 自分の投稿
      canViewMain = true;
    } else {
      const access = await this.prisma.postAccess.findUnique({
        where: {
          userId_postId: {
            userId: viewerId,
            postId,
          },
        },
      });

      const expired = access?.expiresAt && access.expiresAt <= new Date();
      canViewMain = !!access && !expired;
    }

    return {
      post,
      canViewMain,
      canViewSample,
      sampleMedia, // 必要ならフロントでそのまま使えるように返しておく
    };
  }
}