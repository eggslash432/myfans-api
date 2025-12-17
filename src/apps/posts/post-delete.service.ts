// api/src/apps/posts/post-delete.service.ts
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MediaStorageService } from '../storage/media-storage.service';
import { isMediaOnS3, extractS3KeyFromMediaUrl } from 'src/shared/media.util';

@Injectable()
export class PostDeleteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: MediaStorageService, // ✅ change
  ) {}

  async deleteAsAdmin(postId: string) {
    await this.deleteCore({ postId });
    return { ok: true };
  }

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

  async deleteManyAsAdmin(postIds: string[]) {
    const ids = Array.from(new Set(postIds)).map(String).filter(Boolean);
    if (ids.length === 0) return { ok: true, deleted: 0, deletedMedia: 0 };

    const media = await this.prisma.postMedia.findMany({
      where: { postId: { in: ids } },
      select: { url: true },
    });

    const keys = this.buildS3KeysFromUrls(media.map((m) => m.url));

    // ✅ S3は StorageModule 内で隠蔽
    await this.safeDeleteKeys(keys);

    const deleted = await this.prisma.post.deleteMany({
      where: { id: { in: ids } },
    });

    return { ok: true, deleted: deleted.count, deletedMedia: keys.length };
  }

  private async deleteCore(opts: { postId: string }) {
    const post = await this.prisma.post.findUnique({
      where: { id: opts.postId },
      select: { id: true },
    });
    if (!post) throw new NotFoundException('post not found');

    const media = await this.prisma.postMedia.findMany({
      where: { postId: opts.postId },
      select: { url: true },
    });

    const keys = this.buildS3KeysFromUrls(media.map((m) => m.url));

    await this.safeDeleteKeys(keys);

    await this.prisma.post.delete({ where: { id: opts.postId } });

    return { ok: true, deletedMedia: keys.length };
  }

  private buildS3KeysFromUrls(urls: Array<string | null>) {
    const keys = urls
      .map((url) => (url ? String(url) : ''))
      .filter((url) => !!url && isMediaOnS3(url))
      .map((url) => extractS3KeyFromMediaUrl(url))
      .filter((k): k is string => !!k);

    return Array.from(new Set(keys));
  }

  private async safeDeleteKeys(keys: string[]) {
    try {
      // MediaStorageService 側で keys.length===0 を無視する実装でもOK
      if (keys.length > 0) {
        await this.storage.deleteKeys(keys);
      }
    } catch (e: any) {
      throw new InternalServerErrorException(
        e?.message || 'failed to delete media on storage',
      );
    }
  }
}
