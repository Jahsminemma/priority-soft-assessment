import { DateTime, Settings } from "luxon";
import type { ConstraintViolation } from "@shiftsync/shared";

Settings.defaultLocale = "en-US";

export type AvailabilityRuleInput = {
  dayOfWeek: number;
  startLocalTime: string;
  endLocalTime: string;
};

export type AvailabilityExceptionInput = {
  startAtUtc: Date;
  endAtUtc: Date;
  type: "UNAVAILABLE" | "AVAILABLE_OVERRIDE";
};

export type ShiftIntervalInput = {
  shiftId: string;
  startAtUtc: Date;
  endAtUtc: Date;
  locationTzIana: string;
};

export type ConstraintContext = {
  locationId: string;
  shift: ShiftIntervalInput;
  requiredSkillId: string;
  staffUserId: string;
  staffSkillIds: string[];
  certifiedLocationIds: string[];
  availabilityRules: AvailabilityRuleInput[];
  availabilityExceptions: AvailabilityExceptionInput[];
  otherAssignments: ShiftIntervalInput[];
};

const REST_HOURS = 10;
const MS_PER_HOUR = 60 * 60 * 1000;

function parseTimeToMinutes(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

export function splitShiftIntoLocalDaySegments(
  startAtUtc: Date,
  endAtUtc: Date,
  locationTzIana: string,
): Array<{ start: DateTime; end: DateTime }> {
  const zone = locationTzIana;
  let start = DateTime.fromJSDate(startAtUtc, { zone: "utc" }).setZone(zone);
  const end = DateTime.fromJSDate(endAtUtc, { zone: "utc" }).setZone(zone);
  if (!start.isValid || !end.isValid || end <= start) {
    return [];
  }
  const segments: Array<{ start: DateTime; end: DateTime }> = [];
  let cur = start;
  while (cur < end) {
    const nextMidnight = cur.startOf("day").plus({ days: 1 });
    const segEnd = end < nextMidnight ? end : nextMidnight;
    segments.push({ start: cur, end: segEnd });
    cur = segEnd;
  }
  return segments;
}

function luxonWeekdayToDb(luxonWeekday: number): number {
  return luxonWeekday === 7 ? 0 : luxonWeekday;
}

function segmentCoveredByRules(
  segStart: DateTime,
  segEnd: DateTime,
  rules: AvailabilityRuleInput[],
): boolean {
  const wd = luxonWeekdayToDb(segStart.weekday);
  const dayRules = rules.filter((r) => r.dayOfWeek === wd);
  if (dayRules.length === 0) return false;
  const segStartMin = segStart.hour * 60 + segStart.minute + segStart.second / 60;
  const segEndMin = segEnd.hour * 60 + segEnd.minute + segEnd.second / 60;
  for (const r of dayRules) {
    const a = parseTimeToMinutes(r.startLocalTime);
    const b = parseTimeToMinutes(r.endLocalTime);
    if (a === null || b === null) continue;
    if (b > a) {
      if (segStartMin >= a && segEndMin <= b) return true;
    }
  }
  return false;
}

function isBlockedByUnavailableException(
  startUtc: Date,
  endUtc: Date,
  exceptions: AvailabilityExceptionInput[],
): boolean {
  const s = startUtc.getTime();
  const e = endUtc.getTime();
  for (const ex of exceptions) {
    if (ex.type !== "UNAVAILABLE") continue;
    const xs = ex.startAtUtc.getTime();
    const xe = ex.endAtUtc.getTime();
    if (s < xe && e > xs) return true;
  }
  return false;
}

export function intervalsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

/** Minimum gap between two non-overlapping intervals (ms). */
export function minGapBetweenNonOverlapping(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): number | null {
  if (intervalsOverlap(aStart, aEnd, bStart, bEnd)) return null;
  if (aEnd.getTime() <= bStart.getTime()) return bStart.getTime() - aEnd.getTime();
  if (bEnd.getTime() <= aStart.getTime()) return aStart.getTime() - bEnd.getTime();
  return null;
}

export function evaluateAssignmentConstraints(
  ctx: ConstraintContext,
  opts: { seventhDayOverrideReason?: string | undefined },
): { hard: ConstraintViolation[]; warnings: ConstraintViolation[] } {
  const hard: ConstraintViolation[] = [];
  const warnings: ConstraintViolation[] = [];
  const { shift, requiredSkillId, staffSkillIds, certifiedLocationIds, locationId } = ctx;

  if (!staffSkillIds.includes(requiredSkillId)) {
    hard.push({
      code: "MISSING_SKILL",
      message: "Staff does not have the required skill for this shift.",
      severity: "hard",
    });
  }

  if (!certifiedLocationIds.includes(locationId)) {
    hard.push({
      code: "NOT_CERTIFIED",
      message: "Staff is not certified for this shift's location.",
      severity: "hard",
    });
  }

  if (isBlockedByUnavailableException(shift.startAtUtc, shift.endAtUtc, ctx.availabilityExceptions)) {
    hard.push({
      code: "OUTSIDE_AVAILABILITY",
      message: "Staff marked unavailable during this time.",
      severity: "hard",
    });
  }

  const segments = splitShiftIntoLocalDaySegments(
    shift.startAtUtc,
    shift.endAtUtc,
    shift.locationTzIana,
  );
  if (segments.length === 0) {
    hard.push({
      code: "OUTSIDE_AVAILABILITY",
      message: "Invalid shift time range.",
      severity: "hard",
    });
  } else {
    for (const seg of segments) {
      if (!segmentCoveredByRules(seg.start, seg.end, ctx.availabilityRules)) {
        hard.push({
          code: "OUTSIDE_AVAILABILITY",
          message: `Shift falls outside recurring availability (local segment ${seg.start.toISO() ?? ""}).`,
          severity: "hard",
        });
        break;
      }
    }
  }

  const allForPairwise = [...ctx.otherAssignments, shift];
  let foundDouble = false;
  let foundRest = false;
  for (let i = 0; i < allForPairwise.length; i++) {
    for (let j = i + 1; j < allForPairwise.length; j++) {
      const A = allForPairwise[i]!;
      const B = allForPairwise[j]!;
      if (intervalsOverlap(A.startAtUtc, A.endAtUtc, B.startAtUtc, B.endAtUtc)) {
        foundDouble = true;
      }
    }
  }
  if (!foundDouble) {
    for (let i = 0; i < allForPairwise.length; i++) {
      for (let j = i + 1; j < allForPairwise.length; j++) {
        const A = allForPairwise[i]!;
        const B = allForPairwise[j]!;
        const gap = minGapBetweenNonOverlapping(
          A.startAtUtc,
          A.endAtUtc,
          B.startAtUtc,
          B.endAtUtc,
        );
        if (gap !== null && gap < REST_HOURS * MS_PER_HOUR) {
          foundRest = true;
        }
      }
    }
  }
  if (foundDouble) {
    hard.push({
      code: "DOUBLE_BOOK",
      message: "Staff is already assigned to an overlapping shift.",
      severity: "hard",
    });
  } else if (foundRest) {
    hard.push({
      code: "REST_10H",
      message: `Less than ${REST_HOURS} hours between two assignments.`,
      severity: "hard",
    });
  }

  const allShifts: ShiftIntervalInput[] = [...ctx.otherAssignments, shift];
  const dailyMinutes = computeDailyMinutesInTz(allShifts, shift.locationTzIana);
  for (const [, minutes] of dailyMinutes) {
    if (minutes > 12 * 60) {
      hard.push({
        code: "DAILY_HARD_12H",
        message: "Daily hours would exceed 12 hours (hard block).",
        severity: "hard",
      });
      break;
    }
    if (minutes > 8 * 60) {
      warnings.push({
        code: "DAILY_WARN_8H",
        message: "Daily hours exceed 8 hours (warning).",
        severity: "warn",
      });
    }
  }

  const weeklyMinutes = computeWeeklyMinutesInLocationWeek(
    allShifts,
    shift.locationTzIana,
    shift.startAtUtc,
  );
  if (weeklyMinutes >= 35 * 60 && weeklyMinutes < 40 * 60) {
    warnings.push({
      code: "WEEKLY_WARN_35",
      message: "Weekly hours approaching 40 (warning at 35+).",
      severity: "warn",
    });
  }
  if (weeklyMinutes >= 40 * 60) {
    warnings.push({
      code: "WEEKLY_WARN_40",
      message: "Weekly hours at or above 40 (overtime risk).",
      severity: "warn",
    });
  }

  const consecutive = maxConsecutiveWorkDaysInWeek(
    allShifts,
    shift.locationTzIana,
    shift.startAtUtc,
  );
  if (consecutive === 6) {
    warnings.push({
      code: "CONSECUTIVE_SIXTH_DAY",
      message: "6th consecutive day worked in the week (warning).",
      severity: "warn",
    });
  }
  if (consecutive >= 7) {
    const reason = opts.seventhDayOverrideReason?.trim();
    if (!reason) {
      hard.push({
        code: "WEEKLY_SEVENTH_DAY",
        message: "7th consecutive day worked requires manager override with documented reason.",
        severity: "hard",
      });
    }
  }

  return { hard, warnings };
}

function computeDailyMinutesInTz(
  shifts: ShiftIntervalInput[],
  tz: string,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const sh of shifts) {
    const segs = splitShiftIntoLocalDaySegments(sh.startAtUtc, sh.endAtUtc, tz);
    for (const seg of segs) {
      const key = seg.start.toFormat("yyyy-LL-dd");
      const mins = seg.end.diff(seg.start, "minutes").minutes;
      map.set(key, (map.get(key) ?? 0) + mins);
    }
  }
  return map;
}

function computeWeeklyMinutesInLocationWeek(
  shifts: ShiftIntervalInput[],
  tz: string,
  anchorUtc: Date,
): number {
  const anchor = DateTime.fromJSDate(anchorUtc, { zone: "utc" }).setZone(tz);
  const weekStart = anchor.startOf("week");
  const weekEnd = weekStart.plus({ weeks: 1 });
  let total = 0;
  for (const sh of shifts) {
    const s = DateTime.fromJSDate(sh.startAtUtc, { zone: "utc" }).setZone(tz);
    const e = DateTime.fromJSDate(sh.endAtUtc, { zone: "utc" }).setZone(tz);
    if (e <= weekStart || s >= weekEnd) continue;
    total += e.diff(s, "minutes").minutes;
  }
  return total;
}

function maxConsecutiveWorkDaysInWeek(
  shifts: ShiftIntervalInput[],
  tz: string,
  anchorUtc: Date,
): number {
  const anchor = DateTime.fromJSDate(anchorUtc, { zone: "utc" }).setZone(tz);
  const weekStart = anchor.startOf("week");
  const weekEnd = weekStart.plus({ weeks: 1 });
  const days = new Set<string>();
  for (const sh of shifts) {
    const s = DateTime.fromJSDate(sh.startAtUtc, { zone: "utc" }).setZone(tz);
    const e = DateTime.fromJSDate(sh.endAtUtc, { zone: "utc" }).setZone(tz);
    if (e <= weekStart || s >= weekEnd) continue;
    let cur = s.startOf("day");
    const endDay = e.minus({ milliseconds: 1 }).startOf("day");
    while (cur <= endDay) {
      days.add(cur.toFormat("yyyy-LL-dd"));
      cur = cur.plus({ days: 1 });
    }
  }
  const sorted = [...days].sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of sorted) {
    if (prev) {
      const p = DateTime.fromISO(prev, { zone: tz });
      const n = DateTime.fromISO(d, { zone: tz });
      if (n.diff(p, "days").days === 1) run += 1;
      else run = 1;
    } else {
      run = 1;
    }
    if (run > best) best = run;
    prev = d;
  }
  return best;
}
