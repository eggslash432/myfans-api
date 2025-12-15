// api/src/apps/posts/post-delete.service.ts

import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from '../storage/s3.service';
import { isMediaOnS3, extractS3KeyFromMediaUrl } from 'src/shared/media.util';

@Injectable()
export class PostDeleteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
  ) {}

  /** admin用：物理削除（S3→DB） */
  async deleteAsAdmin(postId: string) {
    await this.deleteCore({ postId });
    return { ok: true };
  }

  /** creator用：自分の投稿だけ物理削除（S3→DB） */
  async deleteAsCreator(postId: string, userId: string) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      select: { id: true, creatorId: true },
    });
    if (!post) throw new NotFoundException('post not found');
    if (post.creatorId !== userId) throw new ForbiddenException();

    await this.deleteCore({ postId });
    return { ok: true };
  }

  /** admin用：まとめて物理削除 */
  async deleteManyAsAdmin(postIds: string[]) {
    const ids = Array.from(new Set(postIds)).filter(Boolean);
    if (ids.length === 0) return { ok: true, deleted: 0 };

    // 先に対象メディアをまとめて拾う
    const media = await this.prisma.postMedia.findMany({
      where: { postId: { in: ids } },
      select: { url: true },
    });

    const keys = media
      .map((m) => m.url)
      .filter((url): url is string => !!url && isMediaOnS3(url))
      .map((url) => extractS3KeyFromMediaUrl(url))
      .filter((k): k is string => !!k);

    // S3削除 → DB削除
    await this.s3.deleteKeys(keys);
    await this.prisma.post.deleteMany({ where: { id: { in: ids } } });

    return { ok: true, deleted: ids.length, deletedMedia: keys.length };
  }

  private async deleteCore(opts: { postId: string }) {
    // 1) メディアURLを先に取得
    const media = await this.prisma.postMedia.findMany({
      where: { postId: opts.postId },
      select: { url: true },
    });

    const keys = media
      .map((m) => m.url)
      .filter((url): url is string => !!url && isMediaOnS3(url))
      .map((url) => extractS3KeyFromMediaUrl(url))
      .filter((k): k is string => !!k);

    // 2) S3削除（失敗したら throw で止める）
    await this.s3.deleteKeys(keys);

    // 3) DB削除（Cascadeで postMedia/postAccess/reports 等が消える）
    await this.prisma.post.delete({ where: { id: opts.postId } });
  }
}
