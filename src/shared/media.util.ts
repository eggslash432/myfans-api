// api/src/shared/media.util.ts

/**
 * MEDIA_BASE_URL を正規化（末尾スラッシュ除去）
 */
export function getMediaBaseUrl(): string {
  return (process.env.MEDIA_BASE_URL || '').replace(/\/+$/, '');
}

/**
 * メディアURLが S3 / CloudFront 配下か判定
 */
export function isMediaOnS3(url: string): boolean {
  const base = getMediaBaseUrl();
  if (!base) return false;
  return url.startsWith(base);
}

/**
 * メディアURLから S3 key を抽出
 * https://xxx.cloudfront.net/posts/xxx.jpg → posts/xxx.jpg
 */
export function extractS3KeyFromMediaUrl(url: string): string {
  const base = getMediaBaseUrl();
  if (!base) {
    throw new Error('MEDIA_BASE_URL is not defined');
  }
  return url.replace(base + '/', '');
}
