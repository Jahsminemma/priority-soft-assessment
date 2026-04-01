import { isoWeekKeyDbVariants } from "@shiftsync/shared";
import { prisma } from "../../infrastructure/persistence/index.js";
import { canManageLocation, type AuthedUser } from "../../security/index.js";

function shiftDurationMinutes(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / 60_000;
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
        shift: true,
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
    if (a.shift.isPremium) cur.premium += 1;
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
