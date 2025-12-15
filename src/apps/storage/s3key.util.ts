// api/src/apps/storage/s3key.util.ts

export function extractKeyFromMediaUrl(url: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.pathname.replace(/^\/+/, '') || null; // "posts/...."
  } catch {
    // 念のため、もし "posts/..." がそのまま入ってるケース
    if (url.startsWith('posts/')) return url;
    return null;
  }
}
