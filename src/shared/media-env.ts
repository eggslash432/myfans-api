// api/src/shared/media-env.ts
export type MediaDriver = 'local' | 's3';

export function getMediaDriver(): MediaDriver {
  const raw = (process.env.MEDIA_DRIVER || '').toLowerCase();
  if (raw === 's3') return 's3';
  return 'local'; // ✅ 未指定は local
}

export const MEDIA_DRIVER: MediaDriver = getMediaDriver();
export const IS_MEDIA_LOCAL = MEDIA_DRIVER === 'local';
export const IS_MEDIA_S3 = MEDIA_DRIVER === 's3';
