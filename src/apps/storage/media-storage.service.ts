// api/src/apps/storage/media-storage.service.ts

import { BadRequestException, Injectable } from '@nestjs/common';
import { IS_MEDIA_LOCAL } from '../../shared/media-env';
import { S3Service } from './s3.service';
import { extname } from 'path';
import { promises as fsp } from 'fs';
import { randomUUID } from 'crypto';
import { join } from 'path';

type TmpSaveInput = {
  postId: string;
  tmpPath: string;        // multer が吐いた tmp ファイル
  originalName: string;
  contentType: string;
};

type BufferSaveInput = {
  postId: string;
  buffer: Buffer;
  originalName: string;
  contentType: string;
};

type TmpSaveAnnouncementInput = {
  announcementId: string;
  tmpPath: string;
  originalName: string;
  contentType: string;
};

type BufferSaveAnnouncementInput = {
  announcementId: string;
  buffer: Buffer;
  originalName: string;
  contentType: string;
};

@Injectable()
export class MediaStorageService {
  constructor(private readonly s3: S3Service) {}

  // =============================
  // Utils
  // =============================

  private sanitizeExt(fileName: string, fallback = '.bin') {
    const ext = (extname(fileName) || fallback).toLowerCase();
    // 変なの来たときの保険（必要なら増やして）
    if (ext.length > 10) return fallback;
    return ext;
  }

  private async ensureDir(dirPath: string) {
    await fsp.mkdir(dirPath, { recursive: true });
  }

  private async safeUnlink(path: string) {
    try {
      await fsp.unlink(path);
    } catch {}
  }

  private localPublicUrlFromAbsolutePath(absPath: string) {
    // abs: <cwd>/uploads/posts/.. -> url: /uploads/posts/..
    const cwd = process.cwd().replace(/\\/g, '/');
    const normalized = absPath.replace(/\\/g, '/');
    const idx = normalized.indexOf(`${cwd}/`);
    const rel = idx >= 0 ? normalized.slice(idx + cwd.length + 1) : normalized; // uploads/...
    return `/${rel}`.replace(/\/{2,}/g, '/');
  }

  // =============================
  // Creator avatar
  // =============================

  async saveCreatorAvatar(params: { userId: string; file: any }): Promise<string> {
    const { userId, file } = params;
    if (!userId) throw new BadRequestException('userId is required');
    if (!file) throw new BadRequestException('file is required');

    if (IS_MEDIA_LOCAL) {
      // diskStorage 前提: file.filename がある
      // destination: uploads/creators
      if (!file.filename) {
        throw new BadRequestException('local upload expects diskStorage (file.filename missing)');
      }
      return `/uploads/creators/${file.filename}`;
    }

    // s3: memoryStorage 前提: file.buffer がある
    if (!file.buffer) {
      throw new BadRequestException('s3 upload expects memoryStorage (file.buffer missing)');
    }

    const ext = this.sanitizeExt(file.originalname || '', '.png');
    const key = `uploads/creators/creator-${userId}-${Date.now()}${ext}`;

    // putObject は assertS3Enabled() を内部で呼ぶので
    // MEDIA_DRIVER=local の時にここに来ることはない
    await this.s3.putObject({
      key,
      contentType: file.mimetype || 'application/octet-stream',
      buffer: file.buffer,
    });

    return `/${key}`;
  }

  // =============================
  // Post media from temp (disk)
  // =============================

  async savePostFileFromTemp(input: TmpSaveInput): Promise<string> {
    const { postId, tmpPath, originalName, contentType } = input;
    if (!postId) throw new BadRequestException('postId is required');
    if (!tmpPath) throw new BadRequestException('tmpPath is required');

    const ext = this.sanitizeExt(originalName, '.bin');

    if (IS_MEDIA_LOCAL) {
      // tmp -> uploads/posts/<postId>/<filename>
      const destDir = join(process.cwd(), 'uploads', 'posts', postId);
      await this.ensureDir(destDir);

      const filename = `${randomUUID()}${ext}`;
      const destPath = join(destDir, filename);

      await fsp.rename(tmpPath, destPath); // move
      return this.localPublicUrlFromAbsolutePath(destPath); // /uploads/posts/<postId>/...
    }

    // s3
    const key = `uploads/posts/${postId}/${Date.now()}-${randomUUID()}${ext}`;
    const url = await this.s3.uploadFilePath({
      key,
      contentType: contentType || 'application/octet-stream',
      filePath: tmpPath,
    });

    await this.safeUnlink(tmpPath); // tmp掃除
    // 返すのは /uploads/... の “パス” に統一（あなたのDB設計に合わせる）
    return `/${key}`;
  }

  // =============================
  // Post media from buffer (memory)
  // =============================

  async savePostFileFromBuffer(input: BufferSaveInput): Promise<string> {
    const { postId, buffer, originalName, contentType } = input;
    if (!postId) throw new BadRequestException('postId is required');
    if (!buffer) throw new BadRequestException('buffer is required');

    const ext = this.sanitizeExt(originalName, '.bin');

    if (IS_MEDIA_LOCAL) {
      const destDir = join(process.cwd(), 'uploads', 'posts', postId);
      await this.ensureDir(destDir);

      const filename = `${randomUUID()}${ext}`;
      const destPath = join(destDir, filename);

      await fsp.writeFile(destPath, buffer);
      return this.localPublicUrlFromAbsolutePath(destPath);
    }

    const key = `uploads/posts/${postId}/${Date.now()}-${randomUUID()}${ext}`;
    await this.s3.putObject({
      key,
      contentType: contentType || 'application/octet-stream',
      buffer,
    });

    return `/${key}`;
  }
  
  // =============================
  // Delete (for admin / post delete)
  // =============================

  /**
   * S3 / Local のメディアをまとめて削除
   * - 入力は "uploads/..." の key（先頭スラッシュ無し想定）
   * - 例: uploads/posts/<postId>/xxx.jpg
   */
  async deleteKeys(keys: string[]) {
    const uniq = Array.from(new Set(keys)).filter(Boolean);
    if (uniq.length === 0) return;

    if (IS_MEDIA_LOCAL) {
      // local: process.cwd() + key を絶対パス化して削除
      // key が "uploads/..." を想定
      await Promise.all(
        uniq.map(async (key) => {
          const abs = join(process.cwd(), key.replace(/^\/+/, ''));
          try {
            await fsp.unlink(abs);
          } catch {
            // ないファイルは無視（運用方針）
          }
        }),
      );
      return;
    }

    // s3
    await this.s3.deleteKeys(uniq);
  }  

  async saveAnnouncementFileFromTemp(input: TmpSaveAnnouncementInput): Promise<string> {
    const { announcementId, tmpPath, originalName, contentType } = input;
    if (!announcementId) throw new BadRequestException('announcementId is required');
    if (!tmpPath) throw new BadRequestException('tmpPath is required');

    const ext = this.sanitizeExt(originalName, '.bin');

    if (IS_MEDIA_LOCAL) {
      // tmp -> uploads/announcements/<id>/<filename>
      const destDir = join(process.cwd(), 'uploads', 'announcements', announcementId);
      await this.ensureDir(destDir);

      const filename = `${randomUUID()}${ext}`;
      const destPath = join(destDir, filename);

      await fsp.rename(tmpPath, destPath);
      return this.localPublicUrlFromAbsolutePath(destPath); // /uploads/announcements/<id>/...
    }

    // s3
    const key = `uploads/announcements/${announcementId}/${Date.now()}-${randomUUID()}${ext}`;
    await this.s3.uploadFilePath({
      key,
      contentType: contentType || 'application/octet-stream',
      filePath: tmpPath,
    });

    await this.safeUnlink(tmpPath);
    return `/${key}`;
  }

  // =============================
  // Announcement media from buffer (memory)
  // =============================
  async saveAnnouncementFileFromBuffer(input: BufferSaveAnnouncementInput): Promise<string> {
    const { announcementId, buffer, originalName, contentType } = input;
    if (!announcementId) throw new BadRequestException('announcementId is required');
    if (!buffer) throw new BadRequestException('buffer is required');

    const ext = this.sanitizeExt(originalName, '.bin');

    if (IS_MEDIA_LOCAL) {
      const destDir = join(process.cwd(), 'uploads', 'announcements', announcementId);
      await this.ensureDir(destDir);

      const filename = `${randomUUID()}${ext}`;
      const destPath = join(destDir, filename);

      await fsp.writeFile(destPath, buffer);
      return this.localPublicUrlFromAbsolutePath(destPath);
    }

    const key = `uploads/announcements/${announcementId}/${Date.now()}-${randomUUID()}${ext}`;
    await this.s3.putObject({
      key,
      contentType: contentType || 'application/octet-stream',
      buffer,
    });

    return `/${key}`;
  }  
}
