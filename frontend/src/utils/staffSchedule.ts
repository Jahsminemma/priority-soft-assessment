import { DateTime } from "luxon";
import type { LocationSummary, ShiftDto } from "@shiftsync/shared";
import { utcIsoToLocalYmd } from "./scheduleTime.js";

export type ShiftDayGroup = {
  dayKey: string;
  dayTitle: string;
  shifts: ShiftDto[];
};

/** Group shifts by local calendar day at each shift’s location (start day). */
export function groupStaffShiftsByDay(
  shifts: ShiftDto[],
  locations: LocationSummary[],
): ShiftDayGroup[] {
  const byId = new Map(locations.map((l) => [l.id, l]));
  const map = new Map<string, ShiftDto[]>();
  for (const s of shifts) {
    const loc = byId.get(s.locationId);
    if (!loc) continue;
    const ymd = utcIsoToLocalYmd(s.startAtUtc, loc.tzIana);
    const arr = map.get(ymd) ?? [];
    arr.push(s);
    map.set(ymd, arr);
  }
  const keys = [...map.keys()].sort();
  return keys.map((dayKey) => {
    const first = map.get(dayKey)![0]!;
    const loc = byId.get(first.locationId)!;
    const dt = DateTime.fromISO(`${dayKey}T12:00:00`, { zone: loc.tzIana });
    const dayTitle = dt.toFormat("EEEE, MMM d");
    const list = [...(map.get(dayKey) ?? [])].sort((a, b) => a.startAtUtc.localeCompare(b.startAtUtc));
    return { dayKey, dayTitle, shifts: list };
  });
}

/** Sum shift lengths in hours (wall-time duration, handles overnight). */
export function totalScheduledHours(shifts: ShiftDto[]): number {
  let total = 0;
  for (const s of shifts) {
    const a = DateTime.fromISO(s.startAtUtc, { zone: "utc" });
    const b = DateTime.fromISO(s.endAtUtc, { zone: "utc" });
    if (!a.isValid || !b.isValid) continue;
    const hours = b.diff(a, "hours").hours;
    if (hours > 0) total += hours;
  }
  return Math.round(total * 10) / 10;
}

/** Next shift that hasn’t ended yet (by start time), or null. */
export function nextUpcomingShift(shifts: ShiftDto[]): ShiftDto | null {
  const now = DateTime.utc();
  const upcoming = shifts
    .filter((s) => {
      const end = DateTime.fromISO(s.endAtUtc, { zone: "utc" });
      return end.isValid && end > now;
    })
    .sort((a, b) => a.startAtUtc.localeCompare(b.startAtUtc));
  return upcoming[0] ?? null;
}

/**
 * Shifts starting on the venue’s local “today” (each shift compared in its location timezone).
 */
export function shiftsStartingTodayAtLocation(
  shifts: ShiftDto[],
  locById: Map<string, { tzIana: string }>,
): ShiftDto[] {
  const out: ShiftDto[] = [];
  for (const s of shifts) {
    const loc = locById.get(s.locationId);
    if (!loc) continue;
    const todayLoc = DateTime.now().setZone(loc.tzIana).toFormat("yyyy-LL-dd");
    const shiftDay = utcIsoToLocalYmd(s.startAtUtc, loc.tzIana);
    if (shiftDay === todayLoc) out.push(s);
  }
  return out.sort((a, b) => a.startAtUtc.localeCompare(b.startAtUtc));
}
