import { DateTime } from "luxon";
import { isoWeekKeyDbVariants } from "@shiftsync/shared";
import {
  fifoStraightOtPerInterval,
  resolveHourlyRateUsd,
  roundUsd,
  type FifoInterval,
} from "../../domain/scheduling/index.js";
import { prisma } from "../../infrastructure/persistence/index.js";
import { canManageLocation, type AuthedUser } from "../../security/index.js";

function shiftDurationMinutes(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / 60_000;
}

/**
 * "Desirable" / premium shifts: explicitly marked premium, or Fri/Sat evening start (local site time, 17:00+).
 */
export function countsAsPremiumDesirableShift(shift: {
  isPremium: boolean;
  startAtUtc: Date;
  location: { tzIana: string };
}): boolean {
  if (shift.isPremium) return true;
  const dt = DateTime.fromJSDate(shift.startAtUtc, { zone: "utc" }).setZone(shift.location.tzIana);
  const wd = dt.weekday;
  const isFriOrSat = wd === 5 || wd === 6;
  const evening = dt.hour >= 17;
  return isFriOrSat && evening;
}

async function manageableLocationIds(actor: AuthedUser): Promise<string[]> {
  if (actor.role === "ADMIN") {
    const rows = await prisma.location.findMany({ select: { id: true }, orderBy: { name: "asc" } });
    return rows.map((r) => r.id);
  }
  if (actor.role === "MANAGER") return [...actor.managerLocationIds];
  return [];
}

async function resolveLocationFilter(
  actor: AuthedUser,
  locationId: string | "all",
): Promise<string[] | null> {
  if (locationId === "all") {
    return manageableLocationIds(actor);
  }
  if (!canManageLocation(actor, locationId)) return null;
  return [locationId];
}

export type FairnessRow = {
  staffUserId: string;
  name: string;
  scheduledMinutes: number;
  scheduledHours: number;
  /** Distinct shifts assigned in the selected week (and scope). */
  shiftCount: number;
  premiumShiftCount: number;
  desiredHoursWeekly: number | null;
  /** Difference between this staff member's share of premium shifts and an equal split (can be negative). */
  premiumDeltaVsEqualShare: number;
};

type StaffAgg = {
  name: string;
  minutes: number;
  premium: number;
  desired: number | null;
  shiftIds: Set<string>;
};

export async function fairnessReport(
  actor: AuthedUser,
  locationId: string | "all",
  weekKey: string,
): Promise<FairnessRow[] | null> {
  const locationIds = await resolveLocationFilter(actor, locationId);
  if (locationIds === null) return null;
  if (locationIds.length === 0) return [];

  const weekKeys = isoWeekKeyDbVariants(weekKey);

  const [assignments, certs] = await Promise.all([
    prisma.shiftAssignment.findMany({
      where: {
        shift: { locationId: { in: locationIds }, weekKey: { in: weekKeys } },
      },
      include: {
        shift: { include: { location: { select: { tzIana: true } } } },
        staff: { select: { id: true, name: true, desiredHoursWeekly: true } },
      },
    }),
    prisma.staffCertification.findMany({
      where: { locationId: { in: locationIds } },
      select: {
        userId: true,
        user: { select: { id: true, name: true, desiredHoursWeekly: true } },
      },
    }),
  ]);

  const byStaff = new Map<string, StaffAgg>();

  for (const c of certs) {
    if (!byStaff.has(c.userId)) {
      byStaff.set(c.userId, {
        name: c.user.name,
        minutes: 0,
        premium: 0,
        desired: c.user.desiredHoursWeekly,
        shiftIds: new Set(),
      });
    }
  }

  for (const a of assignments) {
    const m = shiftDurationMinutes(a.shift.startAtUtc, a.shift.endAtUtc);
    let cur = byStaff.get(a.staffUserId);
    if (!cur) {
      cur = {
        name: a.staff.name,
        minutes: 0,
        premium: 0,
        desired: a.staff.desiredHoursWeekly,
        shiftIds: new Set(),
      };
      byStaff.set(a.staffUserId, cur);
    }
    cur.minutes += m;
    if (countsAsPremiumDesirableShift(a.shift)) cur.premium += 1;
    cur.shiftIds.add(a.shiftId);
  }

  const sortedEntries = [...byStaff.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  const totalPremium = sortedEntries.reduce((s, [, v]) => s + v.premium, 0);
  const n = sortedEntries.length || 1;
  const equalShare = totalPremium / n;

  return sortedEntries.map(([staffUserId, v]) => ({
    staffUserId,
    name: v.name,
    scheduledMinutes: v.minutes,
    scheduledHours: Math.round((v.minutes / 60) * 100) / 100,
    shiftCount: v.shiftIds.size,
    premiumShiftCount: v.premium,
    desiredHoursWeekly: v.desired,
    premiumDeltaVsEqualShare: Math.round((v.premium - equalShare) * 100) / 100,
  }));
}

export type OvertimeWeekRow = {
  staffUserId: string;
  name: string;
  weeklyMinutes: number;
  weeklyHours: number;
  warnings: string[];
};

export async function overtimeWeekReport(
  actor: AuthedUser,
  locationId: string | "all",
  weekKey: string,
): Promise<OvertimeWeekRow[] | null> {
  const locationIds = await resolveLocationFilter(actor, locationId);
  if (locationIds === null) return null;
  if (locationIds.length === 0) return [];

  const weekKeysOt = isoWeekKeyDbVariants(weekKey);
  const assignments = await prisma.shiftAssignment.findMany({
    where: {
      shift: { locationId: { in: locationIds }, weekKey: { in: weekKeysOt } },
    },
    include: {
      shift: true,
      staff: { select: { id: true, name: true } },
    },
  });

  const byStaff = new Map<string, { name: string; minutes: number }>();
  for (const a of assignments) {
    const m = shiftDurationMinutes(a.shift.startAtUtc, a.shift.endAtUtc);
    const cur = byStaff.get(a.staffUserId) ?? { name: a.staff.name, minutes: 0 };
    cur.minutes += m;
    byStaff.set(a.staffUserId, cur);
  }

  return [...byStaff.entries()]
    .sort((a, b) => a[1].name.localeCompare(b[1].name))
    .map(([staffUserId, v]) => {
      const warnings: string[] = [];
      if (v.minutes >= 35 * 60 && v.minutes < 40 * 60) warnings.push("WEEKLY_WARN_35");
      if (v.minutes >= 40 * 60) warnings.push("WEEKLY_WARN_40");
      return {
        staffUserId,
        name: v.name,
        weeklyMinutes: Math.round(v.minutes),
        weeklyHours: Math.round((v.minutes / 60) * 100) / 100,
        warnings,
      };
    });
}

export type OvertimeCostAssignmentRow = {
  assignmentId: string;
  shiftId: string;
  staffUserId: string;
  staffName: string;
  straightMinutes: number;
  otMinutes: number;
  straightUsd: number;
  otUsd: number;
  hourlyRateUsd: number;
};

export type OvertimeCostStaffRow = {
  staffUserId: string;
  name: string;
  weeklyMinutes: number;
  weeklyStraightMinutes: number;
  weeklyOtMinutes: number;
  straightUsd: number;
  otUsd: number;
  totalLaborUsd: number;
};

export type OvertimeCostWeekPayload = {
  weekKey: string;
  totalStraightUsd: number;
  totalOtUsd: number;
  totalLaborUsd: number;
  staff: OvertimeCostStaffRow[];
  assignments: OvertimeCostAssignmentRow[];
};

export async function overtimeCostWeekReport(
  actor: AuthedUser,
  locationId: string | "all",
  weekKey: string,
): Promise<OvertimeCostWeekPayload | null> {
  const locationIds = await resolveLocationFilter(actor, locationId);
  if (locationIds === null) return null;
  if (locationIds.length === 0) {
    return {
      weekKey,
      totalStraightUsd: 0,
      totalOtUsd: 0,
      totalLaborUsd: 0,
      staff: [],
      assignments: [],
    };
  }

  const weekKeysOt = isoWeekKeyDbVariants(weekKey);
  const assignments = await prisma.shiftAssignment.findMany({
    where: {
      shift: { locationId: { in: locationIds }, weekKey: { in: weekKeysOt } },
    },
    include: {
      shift: true,
      staff: { select: { id: true, name: true, hourlyRate: true } },
    },
  });

  const locIds = [...new Set(assignments.map((a) => a.shift.locationId))];
  const locRows =
    locIds.length > 0
      ? await prisma.location.findMany({
          where: { id: { in: locIds } },
          select: { id: true, defaultHourlyRate: true },
        })
      : [];
  const locDefaultById = new Map(locRows.map((l) => [l.id, l.defaultHourlyRate]));

  const byStaff = new Map<
    string,
    {
      name: string;
      rows: typeof assignments;
    }
  >();
  for (const a of assignments) {
    const cur = byStaff.get(a.staffUserId) ?? { name: a.staff.name, rows: [] as typeof assignments };
    cur.rows.push(a);
    byStaff.set(a.staffUserId, cur);
  }

  const assignmentOut: OvertimeCostAssignmentRow[] = [];
  const staffOut: OvertimeCostStaffRow[] = [];
  let totalStraightUsd = 0;
  let totalOtUsd = 0;

  for (const [staffUserId, { name, rows }] of byStaff) {
    rows.sort((a, b) => {
      const t = a.shift.startAtUtc.getTime() - b.shift.startAtUtc.getTime();
      return t !== 0 ? t : a.id.localeCompare(b.id);
    });

    const intervals: FifoInterval[] = rows.map((a) => ({
      id: a.id,
      startMs: a.shift.startAtUtc.getTime(),
      durationMin: shiftDurationMinutes(a.shift.startAtUtc, a.shift.endAtUtc),
    }));
    const splitMap = fifoStraightOtPerInterval(intervals);

    let sStraightMin = 0;
    let sOtMin = 0;
    let sStraightUsd = 0;
    let sOtUsd = 0;
    let weeklyMin = 0;

    for (const a of rows) {
      const split = splitMap.get(a.id)!;
      const locDefault = locDefaultById.get(a.shift.locationId) ?? null;
      const rate = resolveHourlyRateUsd(a.staff.hourlyRate, locDefault);
      const straightUsd = roundUsd((split.straightMin / 60) * rate);
      const otUsd = roundUsd((split.otMin / 60) * rate * 1.5);
      weeklyMin += split.straightMin + split.otMin;
      sStraightMin += split.straightMin;
      sOtMin += split.otMin;
      sStraightUsd += straightUsd;
      sOtUsd += otUsd;
      assignmentOut.push({
        assignmentId: a.id,
        shiftId: a.shiftId,
        staffUserId,
        staffName: name,
        straightMinutes: Math.round(split.straightMin),
        otMinutes: Math.round(split.otMin),
        straightUsd,
        otUsd,
        hourlyRateUsd: rate,
      });
    }

    sStraightUsd = roundUsd(sStraightUsd);
    sOtUsd = roundUsd(sOtUsd);
    const totalLabor = roundUsd(sStraightUsd + sOtUsd);
    totalStraightUsd += sStraightUsd;
    totalOtUsd += sOtUsd;
    staffOut.push({
      staffUserId,
      name,
      weeklyMinutes: Math.round(weeklyMin),
      weeklyStraightMinutes: Math.round(sStraightMin),
      weeklyOtMinutes: Math.round(sOtMin),
      straightUsd: sStraightUsd,
      otUsd: sOtUsd,
      totalLaborUsd: totalLabor,
    });
  }

  staffOut.sort((a, b) => a.name.localeCompare(b.name));
  assignmentOut.sort((a, b) => {
    const t = a.staffName.localeCompare(b.staffName);
    return t !== 0 ? t : a.shiftId.localeCompare(b.shiftId);
  });

  return {
    weekKey,
    totalStraightUsd: roundUsd(totalStraightUsd),
    totalOtUsd: roundUsd(totalOtUsd),
    totalLaborUsd: roundUsd(totalStraightUsd + totalOtUsd),
    staff: staffOut,
    assignments: assignmentOut,
  };
}
