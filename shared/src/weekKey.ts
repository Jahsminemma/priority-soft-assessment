/**
 * Canonical ISO week key: `YYYY-Www` with week zero-padded (e.g. 2026-W09).
 * Use everywhere we persist or query `weekKey` so `2026-W9` and `2026-W09` don’t split rows.
 */
export function normalizeIsoWeekKey(weekKey: string): string {
  const m = /^(\d{4})-W(\d{1,2})$/.exec(weekKey.trim());
  if (!m) return weekKey.trim();
  const year = m[1]!;
  const w = Number(m[2]);
  if (w < 1 || w > 53) return weekKey.trim();
  return `${year}-W${String(w).padStart(2, "0")}`;
}

/**
 * Values that might exist in the DB for the same ISO week (legacy unpadded vs padded).
 * Use in `where: { weekKey: { in: variants } }` so lists return all shifts for that week.
 */
export function isoWeekKeyDbVariants(weekKey: string): string[] {
  const n = normalizeIsoWeekKey(weekKey);
  const m = /^(\d{4})-W(\d{1,2})$/.exec(n);
  if (!m) return [weekKey.trim()];
  const year = m[1]!;
  const w = Number(m[2]);
  const padded = `${year}-W${String(w).padStart(2, "0")}`;
  const unpadded = w < 10 ? `${year}-W${w}` : null;
  if (unpadded && unpadded !== padded) {
    return [...new Set([padded, unpadded])];
  }
  return [padded];
}

/** Lexicographic compare on normalized keys (works for ordering across years when weeks are zero-padded). */
export function compareIsoWeekKeys(a: string, b: string): number {
  const na = normalizeIsoWeekKey(a);
  const nb = normalizeIsoWeekKey(b);
  return na < nb ? -1 : na > nb ? 1 : 0;
}
