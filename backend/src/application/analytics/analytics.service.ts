import { isoWeekKeyDbVariants } from "@shiftsync/shared";
import { prisma } from "../../infrastructure/persistence/index.js";
import { canManageLocation, type AuthedUser } from "../../security/index.js";

function shiftDurationMinutes(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / 60_000;
}

export type FairnessRow = {
  staffUserId: string;
  name: string;
  scheduledMinutes: number;
  scheduledHours: number;
  premiumShiftCount: number;
  desiredHoursWeekly: number | null;
  /** Difference between this staff member's share of premium shifts and an equal split (can be negative). */
  premiumDeltaVsEqualShare: number;
};

export async function fairnessReport(
  actor: AuthedUser,
  locationId: string,
  weekKey: string,
): Promise<FairnessRow[] | null> {
  if (!canManageLocation(actor, locationId)) return null;

  const weekKeys = isoWeekKeyDbVariants(weekKey);
  const assignments = await prisma.shiftAssignment.findMany({
    where: {
      shift: { locationId, weekKey: { in: weekKeys } },
    },
    include: {
      shift: true,
      staff: { select: { id: true, name: true, desiredHoursWeekly: true } },
    },
  });

  const byStaff = new Map<
    string,
    { name: string; minutes: number; premium: number; desired: number | null }
  >();

  for (const a of assignments) {
    const m = shiftDurationMinutes(a.shift.startAtUtc, a.shift.endAtUtc);
    const cur = byStaff.get(a.staffUserId) ?? {
      name: a.staff.name,
      minutes: 0,
      premium: 0,
      desired: a.staff.desiredHoursWeekly,
    };
    cur.minutes += m;
    if (a.shift.isPremium) cur.premium += 1;
    byStaff.set(a.staffUserId, cur);
  }

  const rows = [...byStaff.values()];
  const totalPremium = rows.reduce((s, v) => s + v.premium, 0);
  const n = rows.length || 1;
  const equalShare = totalPremium / n;

  return [...byStaff.entries()].map(([staffUserId, v]) => ({
    staffUserId,
    name: v.name,
    scheduledMinutes: v.minutes,
    scheduledHours: Math.round((v.minutes / 60) * 100) / 100,
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
  locationId: string,
  weekKey: string,
): Promise<OvertimeWeekRow[] | null> {
  if (!canManageLocation(actor, locationId)) return null;

  const weekKeysOt = isoWeekKeyDbVariants(weekKey);
  const assignments = await prisma.shiftAssignment.findMany({
    where: {
      shift: { locationId, weekKey: { in: weekKeysOt } },
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

  return [...byStaff.entries()].map(([staffUserId, v]) => {
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
