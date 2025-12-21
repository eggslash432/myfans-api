// api/src/apps/creators/creators.utils.ts

export function parseYmd(s?: string): Date | null {
  if (!s) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export function endExclusive(to?: string): Date | null {
  const d = parseYmd(to);
  if (!d) return null;
  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}
