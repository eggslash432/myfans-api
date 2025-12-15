// api/src/apps/storage/s3.service.ts

import { Injectable } from '@nestjs/common';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { 
  S3Client, 
  PutObjectCommand, 
  DeleteObjectCommand, 
  DeleteObjectsCommand 
} from '@aws-sdk/client-s3';

@Injectable()
export class S3Service {
  private readonly client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });

  async createUploadUrl(opts: { fileName: string; contentType: string }) {
    const bucket = process.env.MEDIA_BUCKET_NAME!;
    const ext = opts.fileName.split('.').pop() || 'bin';
    const key = `posts/${randomUUID()}.${ext}`;

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: opts.contentType,
      // ACL はバケットポリシー次第。とりあえず private のままでOK
    });

    const uploadUrl = await getSignedUrl(this.client, command, {
      expiresIn: 60 * 5, // 5分有効
    });

    const fileUrl = `${process.env.MEDIA_BASE_URL}/${key}`;
    return { uploadUrl, fileUrl, key };
  }

  // ★ 追加：サーバ側から直接アップロードする用
  async uploadPostFileBuffer(params: {
    postId: string;
    fileName: string;
    contentType: string;
    buffer: Buffer;
  }): Promise<string> {
    const bucket = process.env.MEDIA_BUCKET_NAME!;
    const ext = params.fileName.split('.').pop() || 'bin';
    const key = `posts/${params.postId}/${randomUUID()}.${ext}`;

    await this.client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: params.buffer,
        ContentType: params.contentType,
      }),
    );

    const base = (process.env.MEDIA_BASE_URL || '').replace(/\/+$/, '');
    return `${base}/${key}`;
  }  

  async deleteKeys(keys: string[]) {
    const bucket = process.env.MEDIA_BUCKET_NAME!;
    const uniq = Array.from(new Set(keys)).filter(Boolean);
    if (uniq.length === 0) return;

    // 1件だけなら単体削除
    if (uniq.length === 1) {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: uniq[0],
        }),
      );
      return;
    }

    // 複数件まとめて削除（最大1000/回）
    await this.client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: uniq.map((k) => ({ Key: k })), Quiet: true },
      }),
    );
  }
}
