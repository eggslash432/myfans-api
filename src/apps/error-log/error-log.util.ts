// api/src/apps/error-log/error-log.util.ts

import type { Request } from 'express';

export function getIp(req: Request): string | null {
  const xf = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
  return xf || (req.ip ?? null);
}

export function getUa(req: Request): string | null {
  return (req.headers['user-agent'] as string | undefined) ?? null;
}

// 最小マスク：password / token / authorization / card 等を削る
export function maskDeep(obj: any): any {
  const deny = ['password', 'pass', 'token', 'access_token', 'refresh_token', 'authorization', 'card', 'cvc'];
  if (obj == null) return obj;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(maskDeep);

  const out: any = {};
  for (const [k, v] of Object.entries(obj)) {
    if (deny.includes(k.toLowerCase())) out[k] = '[REDACTED]';
    else out[k] = maskDeep(v);
  }
  return out;
}
