import { DateTime } from "luxon";

/** Parses ISO week keys like `2026-W09` into the Monday of that week in the given IANA zone. */
export function weekStartDateLocalFromWeekKey(weekKey: string, tzIana: string): string {
  const m = /^(\d{4})-W(\d{1,2})$/.exec(weekKey.trim());
  if (!m) throw new Error("INVALID_WEEK_KEY");
  const weekYear = Number(m[1]);
  const weekNumber = Number(m[2]);
  const start = DateTime.fromObject({ weekYear, weekNumber }, { zone: tzIana }).startOf("week");
  if (!start.isValid) throw new Error("INVALID_WEEK_KEY");
  return start.toFormat("yyyy-LL-dd");
}
