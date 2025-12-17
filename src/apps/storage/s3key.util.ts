// api/src/apps/storage/s3key.util.ts

export function extractKeyFromMediaUrl(url: string): string | null {
  if (!url) return null;

  // 相対 "/uploads/..." を許可
  if (url.startsWith('/')) return url.replace(/^\/+/, '');

  try {
    const u = new URL(url);
    return u.pathname.replace(/^\/+/, '') || null;
  } catch {
    if (url.startsWith('uploads/') || url.startsWith('posts/')) return url;
    return null;
  }
}
