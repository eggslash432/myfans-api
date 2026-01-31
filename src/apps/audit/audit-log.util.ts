// api/src/apps/audit/audit-log.util.ts

export function makeTarget(type: string, id: string) {
  return `${type.toLowerCase()}:${id}`;
}

export function getIp(req: any): string | null {
  // behind proxy の場合は X-Forwarded-For を優先
  const xff = req.headers?.['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) return xff.split(',')[0].trim();
  return req.ip ?? null;
}

export function getUa(req: any): string | null {
  const ua = req.headers?.['user-agent'];
  return typeof ua === 'string' ? ua : null;
}
