import { DateTime } from "luxon";
import { addDaysYmd, maxYmd } from "./weekKey.js";

/** Local calendar date (YYYY-MM-DD) of an instant in the given IANA zone. */
export function utcIsoToLocalYmd(isoUtc: string, zone: string): string {
  return DateTime.fromISO(isoUtc, { zone: "utc" }).setZone(zone).toFormat("yyyy-LL-dd");
}

/**
 * The seven calendar days of the ISO week (Mon–Sun) in `zone`, aligned with the backend week key.
 * Returns YYYY-MM-DD strings in order Monday → Sunday.
 */
export function isoWeekDayKeysInLocationZone(weekKey: string, zone: string): string[] {
  const m = /^(\d{4})-W(\d{1,2})$/.exec(weekKey.trim());
  if (!m) return [];
  const weekYear = Number(m[1]);
  const weekNumber = Number(m[2]);
  const start = DateTime.fromObject({ weekYear, weekNumber }, { zone }).startOf("week");
  if (!start.isValid) return [];
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    out.push(start.plus({ days: i }).toFormat("yyyy-LL-dd"));
  }
  return out;
}

/** Monday YYYY-MM-DD of this ISO week in the location zone (same basis as schedule column headers). */
export function weekKeyMondayYmdInZone(weekKey: string, zone: string): string | null {
  const days = isoWeekDayKeysInLocationZone(weekKey, zone);
  return days[0] ?? null;
}

/**
 * Compact week range label using wall dates in `zone` (matches `isoWeekDayKeysInLocationZone`, not browser-local Monday math).
 */
export function formatWeekRangeCompactInZone(weekKey: string, zone: string): string {
  const days = isoWeekDayKeysInLocationZone(weekKey, zone);
  if (days.length < 7) return weekKey;
  const start = DateTime.fromISO(`${days[0]}T12:00`, { zone });
  const end = DateTime.fromISO(`${days[6]}T12:00`, { zone });
  if (!start.isValid || !end.isValid) return weekKey;
  return `${start.toFormat("MMM d, yyyy")} – ${end.toFormat("MMM d, yyyy")}`;
}

/** Short time range in zone for a shift block in a calendar cell. */
export function formatShiftTimeRangeShort(startAtUtc: string, endAtUtc: string, zone: string): string {
  const s = DateTime.fromISO(startAtUtc, { zone: "utc" }).setZone(zone).toFormat("h:mm a");
  const e = DateTime.fromISO(endAtUtc, { zone: "utc" }).setZone(zone).toFormat("h:mm a");
  return `${s} – ${e}`;
}

/** Interpret calendar date + wall time in an IANA zone; return UTC ISO for the API. */
export function wallDateTimeToUtcIso(dateYmd: string, timeHm: string, zone: string): string | null {
  const t = timeHm.trim();
  if (!dateYmd || !t) return null;
  // Normalize input from <input type="time"> across browsers (e.g. "9:00" vs "09:00").
  // Accept HH:mm, H:mm, and optionally HH:mm:ss / H:mm:ss.
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  const second = m[3] != null ? Number(m[3]) : 0;
  if (Number.isNaN(hour) || Number.isNaN(minute) || Number.isNaN(second)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null;
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  const ss = String(second).padStart(2, "0");
  const dt = DateTime.fromISO(`${dateYmd}T${hh}:${mm}:${ss}`, { zone });
  if (!dt.isValid) return null;
  return dt.toUTC().toISO() ?? null;
}

/**
 * Interpret a `datetime-local` value (YYYY-MM-DDTHH:mm or with seconds) as wall time in `zone`
 * (same convention as shifts). Use this for availability exceptions so they align with location-based shifts.
 */
export function exceptionWallLocalToUtcIso(datetimeLocal: string, zone: string): string | null {
  const raw = datetimeLocal.trim();
  if (!raw) return null;
  const dt = DateTime.fromISO(raw, { zone });
  if (!dt.isValid) return null;
  return dt.toUTC().toISO() ?? null;
}

/** Human-readable stored range: wall times in the zone that was used when saving (or fallback). */
export function formatAvailabilityExceptionRange(
  startIsoUtc: string,
  endIsoUtc: string,
  zone: string,
): string {
  const s = DateTime.fromISO(startIsoUtc, { zone: "utc" }).setZone(zone);
  const e = DateTime.fromISO(endIsoUtc, { zone: "utc" }).setZone(zone);
  if (!s.isValid || !e.isValid) return `${startIsoUtc} → ${endIsoUtc}`;
  const sameDay = s.toFormat("yyyy-LL-dd") === e.toFormat("yyyy-LL-dd");
  if (sameDay) {
    return `${s.toFormat("EEE, MMM d, yyyy")} · ${s.toFormat("h:mm a")} – ${e.toFormat("h:mm a")} · ${zone}`;
  }
  return `${s.toFormat("EEE, MMM d, yyyy · h:mm a")} → ${e.toFormat("EEE, MMM d, yyyy · h:mm a")} · ${zone}`;
}

/** Readable label in the location timezone (for tables and summaries). */
export function formatShiftInZone(isoUtc: string, zone: string): string {
  return DateTime.fromISO(isoUtc, { zone: "utc" }).setZone(zone).toFormat("EEE, MMM d · h:mm a");
}

/** Compact start/end range in the location timezone (for dropdowns). */
export function formatShiftRangeLabel(
  startAtUtc: string,
  endAtUtc: string,
  zone: string,
): string {
  const start = formatShiftInZone(startAtUtc, zone);
  const endT = DateTime.fromISO(endAtUtc, { zone: "utc" }).setZone(zone).toFormat("h:mm a");
  return `${start} – ${endT}`;
}

/** Wall times in zone, e.g. "3:00 PM → 9:00 PM". */
export function formatShiftWallTimeArrow(startAtUtc: string, endAtUtc: string, zone: string): string {
  const s = DateTime.fromISO(startAtUtc, { zone: "utc" }).setZone(zone).toFormat("h:mm a");
  const e = DateTime.fromISO(endAtUtc, { zone: "utc" }).setZone(zone).toFormat("h:mm a");
  return `${s} → ${e}`;
}

export function formatShiftDurationHuman(startAtUtc: string, endAtUtc: string): string {
  const a = DateTime.fromISO(startAtUtc, { zone: "utc" });
  const b = DateTime.fromISO(endAtUtc, { zone: "utc" });
  if (!a.isValid || !b.isValid) return "—";
  const mins = b.diff(a, "minutes").minutes;
  if (mins <= 0) return "—";
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (h === 0) return `${m} min`;
  if (m === 0) return h === 1 ? "1 hour" : `${h} hours`;
  return `${h} hr ${m} min`;
}

export type DateStackParts = { line1: string; line2: string; line3: string };

/** Vertical list-style date: weekday / day / month (location zone). */
export function formatShiftDateStack(startAtUtc: string, zone: string): DateStackParts {
  const s = DateTime.fromISO(startAtUtc, { zone: "utc" }).setZone(zone);
  return {
    line1: s.toFormat("EEE").toUpperCase(),
    line2: s.toFormat("d"),
    line3: s.toFormat("LLL").toUpperCase(),
  };
}

export function formatFullCalendarDateInZone(startAtUtc: string, zone: string): string {
  return DateTime.fromISO(startAtUtc, { zone: "utc" }).setZone(zone).toFormat("EEEE, MMM d, yyyy");
}

function ymdDaysBetween(startYmd: string, endYmd: string): number {
  const [y1, m1, d1] = startYmd.split("-").map(Number);
  const [y2, m2, d2] = endYmd.split("-").map(Number);
  const a = new Date(y1!, m1! - 1, d1!);
  const b = new Date(y2!, m2! - 1, d2!);
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/**
 * Five shifts (Mon–Fri) of the ISO week for `weekKey`, using the same wall times each day.
 * `startDate` / `endDate` define same-day vs overnight: end date may be the same calendar day as start, or the next day.
 * `minStartYmd` skips weekdays on or before that calendar day (e.g. today) so past days in the same week are not scheduled.
 */
export function buildMonFriShiftsUtc(
  weekKey: string,
  startDate: string,
  endDate: string,
  startTime: string,
  endTime: string,
  zone: string,
  minStartYmd: string,
): Array<{ startAtUtc: string; endAtUtc: string }> {
  const mon = weekKeyMondayYmdInZone(weekKey, zone);
  if (!mon) throw new Error("Invalid week.");

  const deltaDays = ymdDaysBetween(startDate, endDate);
  if (deltaDays < 0) throw new Error("End date must be on or after start date.");
  if (deltaDays > 1) {
    throw new Error("For Mon–Fri repeat, end date can be the same day as start or the next day only.");
  }

  const floorYmd = maxYmd(mon, minStartYmd);

  const out: Array<{ startAtUtc: string; endAtUtc: string }> = [];
  for (let i = 0; i < 5; i++) {
    const sYmd = addDaysYmd(mon, i);
    if (sYmd < floorYmd) continue;
    const eYmd = addDaysYmd(mon, i + deltaDays);
    const s = wallDateTimeToUtcIso(sYmd, startTime, zone);
    const e = wallDateTimeToUtcIso(eYmd, endTime, zone);
    if (!s) {
      throw new Error(`Invalid time: start (date=${sYmd}, time=${startTime}, zone=${zone}).`);
    }
    if (!e) {
      throw new Error(`Invalid time: end (date=${eYmd}, time=${endTime}, zone=${zone}).`);
    }
    if (new Date(e) <= new Date(s)) {
      throw new Error(
        "End must be after start for each weekday. For overnight shifts, set the end date to the day after the start date.",
      );
    }
    out.push({ startAtUtc: s, endAtUtc: e });
  }
  if (out.length === 0) {
    throw new Error("No weekdays left in this week—pick a future week or adjust dates.");
  }
  return out;
}
