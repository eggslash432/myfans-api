// api/src/apps/storage/s3.service.ts
import { Injectable } from '@nestjs/common';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { createReadStream } from 'fs';
import { extname } from 'path';

@Injectable()
export class S3Service {
  // ✅ 初期化では落ちない
  private readonly client = new S3Client({
    region: process.env.AWS_REGION,
  });

  // =====================================================
  // 内部ユーティリティ
  // =====================================================
  private assertS3Enabled() {
    const driver = (process.env.MEDIA_DRIVER ?? 'local').toLowerCase();

    if (driver !== 's3') {
      throw new Error(
        `S3Service called but MEDIA_DRIVER=${driver} (expected "s3")`,
      );
    }

    const bucket = process.env.MEDIA_BUCKET_NAME;
    const baseUrl = process.env.MEDIA_BASE_URL;

    if (!bucket) {
      throw new Error('S3Service: MEDIA_BUCKET_NAME is not set');
    }
    if (!baseUrl) {
      throw new Error('S3Service: MEDIA_BASE_URL is not set');
    }

    return { bucket, baseUrl };
  }

  // =====================================================
  // Presigned URL
  // =====================================================
  async createUploadUrl(opts: { fileName: string; contentType: string }) {
    const { bucket, baseUrl } = this.assertS3Enabled();

    const ext = opts.fileName.split('.').pop() || 'bin';
    const key = `posts/${randomUUID()}.${ext}`;

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: opts.contentType,
    });

    const uploadUrl = await getSignedUrl(this.client, command, {
      expiresIn: 60 * 5,
    });

    return {
      uploadUrl,
      fileUrl: `${baseUrl.replace(/\/+$/, '')}/${key}`,
      key,
    };
  }

  // =====================================================
  // Buffer upload
  // =====================================================
  async uploadBuffer(params: {
    key: string;
    contentType: string;
    buffer: Buffer;
  }): Promise<string> {
    const { bucket, baseUrl } = this.assertS3Enabled();

    await this.client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: params.key,
        Body: params.buffer,
        ContentType: params.contentType,
      }),
    );

    return `${baseUrl.replace(/\/+$/, '')}/${params.key}`;
  }

  async putObject(params: {
    key: string;
    contentType: string;
    buffer: Buffer;
  }) {
    const { bucket } = this.assertS3Enabled();

    await this.client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: params.key,
        Body: params.buffer,
        ContentType: params.contentType,
      }),
    );
  }

  // =====================================================
  // File path (stream) upload
  // =====================================================
  async uploadFilePath(params: {
    key: string;
    contentType: string;
    filePath: string;
  }): Promise<string> {
    const { bucket, baseUrl } = this.assertS3Enabled();

    await this.client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: params.key,
        Body: createReadStream(params.filePath),
        ContentType: params.contentType,
      }),
    );

    return `${baseUrl.replace(/\/+$/, '')}/${params.key}`;
  }

  // =====================================================
  // Delete
  // =====================================================
  async deleteKeys(keys: string[]) {
    const { bucket } = this.assertS3Enabled();

    const uniq = Array.from(new Set(keys)).filter(Boolean);
    if (uniq.length === 0) return;

    for (let i = 0; i < uniq.length; i += 1000) {
      const chunk = uniq.slice(i, i + 1000);

      if (chunk.length === 1) {
        await this.client.send(
          new DeleteObjectCommand({
            Bucket: bucket,
            Key: chunk[0],
          }),
        );
        continue;
      }

      const res = await this.client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: chunk.map((Key) => ({ Key })),
            Quiet: true,
          },
        }),
      );

      const errors = res.Errors ?? [];
      if (errors.length > 0) {
        const msg = errors
          .map((e) => `${e.Key ?? '(unknown)'}: ${e.Message ?? e.Code ?? 'error'}`)
          .join('\n');
        throw new Error(`S3 delete failed:\n${msg}`);
      }
    }
  }

  // =====================================================
  // Convenience
  // =====================================================
  async uploadCreatorAvatar(params: {
    creatorUserId: string;
    fileName: string;
    contentType: string;
    buffer: Buffer;
  }) {
    const ext = (extname(params.fileName) || '.png').toLowerCase();
    const key = `uploads/creators/creator-${params.creatorUserId}-${Date.now()}${ext}`;
    const url = await this.uploadBuffer({
      key,
      contentType: params.contentType,
      buffer: params.buffer,
    });
    return { key, url };
  }
}
