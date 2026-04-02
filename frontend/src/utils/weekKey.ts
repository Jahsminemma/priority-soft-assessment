/** ISO week key (YYYY-Www) for a calendar date in the user’s local timezone. */

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function ymdFromDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * ISO 8601 week number and week-year for a local calendar date.
 * Matches Luxon `weekYear` / `weekNumber` used by the backend.
 */
export function localDateToWeekKey(date: Date): string {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const weekYear = d.getFullYear();
  const week1 = new Date(weekYear, 0, 4);
  const week =
    1 +
    Math.round(
      ((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7,
    );
  return `${weekYear}-W${pad2(week)}`;
}

export function localDateStringToWeekKey(ymd: string): string {
  const parts = ymd.split("-").map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (y === undefined || m === undefined || d === undefined) throw new Error("INVALID_DATE");
  return localDateToWeekKey(new Date(y, m - 1, d));
}

export function isValidWeekKey(s: string): boolean {
  return /^(\d{4})-W(\d{1,2})$/.test(s.trim());
}

/** Monday (local) of the ISO week, as YYYY-MM-DD. */
export function weekKeyToLocalMondayYmd(weekKey: string): string | null {
  const m = /^(\d{4})-W(\d{1,2})$/.exec(weekKey.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (week < 1 || week > 53) return null;

  const jan4 = new Date(year, 0, 4);
  const jan4Dow = jan4.getDay() === 0 ? 7 : jan4.getDay();
  const week1Monday = new Date(jan4);
  week1Monday.setDate(jan4.getDate() - (jan4Dow - 1));
  const monday = new Date(week1Monday);
  monday.setDate(week1Monday.getDate() + (week - 1) * 7);

  if (localDateToWeekKey(monday) !== `${year}-W${pad2(week)}`) return null;
  return ymdFromDate(monday);
}

export function formatWeekRangeLabel(weekKey: string, locale = "en"): string {
  const monYmd = weekKeyToLocalMondayYmd(weekKey);
  if (!monYmd) return weekKey;
  const parts = monYmd.split("-").map(Number);
  const y = parts[0]!;
  const mo = parts[1]!;
  const d = parts[2]!;
  const start = new Date(y, mo - 1, d);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric", year: "numeric" };
  return `${start.toLocaleDateString(locale, opts)} – ${end.toLocaleDateString(locale, opts)}`;
}

/** Compact range for schedule headers (e.g. "Mar 29, 2026 – Apr 4, 2026"). */
export function formatWeekRangeCompact(weekKey: string, locale = "en"): string {
  const monYmd = weekKeyToLocalMondayYmd(weekKey);
  if (!monYmd) return weekKey;
  const parts = monYmd.split("-").map(Number);
  const y = parts[0]!;
  const mo = parts[1]!;
  const d = parts[2]!;
  const start = new Date(y, mo - 1, d);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };
  return `${start.toLocaleDateString(locale, opts)} – ${end.toLocaleDateString(locale, opts)}`;
}

export function todayLocalYmd(): string {
  const n = new Date();
  return ymdFromDate(new Date(n.getFullYear(), n.getMonth(), n.getDate()));
}

/** Default week picker value aligned with backend ISO weeks (matches Schedule / seed). */
export function initialWeekKeyFromToday(): string {
  return localDateStringToWeekKey(todayLocalYmd());
}

/** Later calendar day (YYYY-MM-DD). */
export function maxYmd(a: string, b: string): string {
  return a >= b ? a : b;
}

export function addDaysYmd(ymd: string, days: number): string {
  const parts = ymd.split("-").map(Number);
  const y = parts[0]!;
  const m = parts[1]!;
  const d = parts[2]!;
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return ymdFromDate(dt);
}

/**
 * Move by whole ISO weeks from a week key (e.g. +1 = following week, -1 = previous).
 * Used so “Next week” advances from the week you’re viewing, not from “today + 7 days”.
 */
export function shiftWeekKey(weekKey: string, deltaWeeks: number): string | null {
  const mon = weekKeyToLocalMondayYmd(weekKey);
  if (!mon) return null;
  try {
    const targetMon = addDaysYmd(mon, 7 * deltaWeeks);
    return localDateStringToWeekKey(targetMon);
  } catch {
    return null;
  }
}
