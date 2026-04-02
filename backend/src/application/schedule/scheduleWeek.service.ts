import { Prisma } from "@prisma/client";
import { isValidEmergencyOverrideReason, isoWeekKeyDbVariants, normalizeIsoWeekKey } from "@shiftsync/shared";
import { weekStartDateLocalFromWeekKey } from "../../domain/scheduling/index.js";
import { prisma } from "../../infrastructure/persistence/index.js";
import { emitScheduleWeekUpdated } from "../../realtime/events.js";
import { canManageLocation, type AuthedUser } from "../../security/index.js";
import { cancelCoverageForShift } from "../coverage/index.js";
import { createNotification } from "../notifications/notification.service.js";

export async function publishWeek(
  actor: AuthedUser,
  locationId: string,
  weekKey: string,
  cutoffHours?: number,
): Promise<{ weekKey: string; status: "PUBLISHED" } | null> {
  if (!canManageLocation(actor, locationId)) {
    return null;
  }

  const weekKeyNorm = normalizeIsoWeekKey(weekKey);
  const location = await prisma.location.findUnique({ where: { id: locationId } });
  if (!location) throw new Error("LOCATION_NOT_FOUND");
  const weekStartDateLocal = weekStartDateLocalFromWeekKey(weekKeyNorm, location.tzIana);
  const cutoff = cutoffHours ?? 48;

  await prisma.$transaction(async (tx) => {
    await tx.scheduleWeek.upsert({
      where: { locationId_weekStartDateLocal: { locationId, weekStartDateLocal } },
      create: { locationId, weekStartDateLocal, status: "PUBLISHED", cutoffHours: cutoff },
      update: { status: "PUBLISHED", cutoffHours: cutoff },
    });
    await tx.shift.updateMany({
      where: { locationId, weekKey: { in: isoWeekKeyDbVariants(weekKeyNorm) } },
      data: { status: "PUBLISHED" },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: actor.id,
        entityType: "ScheduleWeek",
        entityId: `${locationId}:${weekKeyNorm}`,
        action: "PUBLISH",
        afterJson: { locationId, weekKey: weekKeyNorm, cutoffHours: cutoff } as Prisma.InputJsonValue,
      },
    });
  });

  emitScheduleWeekUpdated(locationId, { weekKey: weekKeyNorm, status: "PUBLISHED" });
  return { weekKey: weekKeyNorm, status: "PUBLISHED" };
}

export type UnpublishWeekOptions = {
  emergencyOverrideReason?: string | undefined;
};

/** True when `now` is within `cutoffHours` before any shift start (or after it has started). */
function anyShiftPastCutoff(cutoffHours: number, shifts: Array<{ startAtUtc: Date }>): boolean {
  const now = Date.now();
  const ms = cutoffHours * 60 * 60 * 1000;
  for (const s of shifts) {
    if (now > s.startAtUtc.getTime() - ms) return true;
  }
  return false;
}

/** True when unpublish/edit-week must be blocked for this actor unless they provide emergency override (or are admin). */
function unpublishBlockedForActor(
  actor: AuthedUser,
  cutoffHours: number,
  shiftsInWeek: Array<{ startAtUtc: Date }>,
  emergencyReason: string | undefined,
): boolean {
  if (!anyShiftPastCutoff(cutoffHours, shiftsInWeek)) return false;
  if (actor.role === "ADMIN") return false;
  if (actor.role === "MANAGER" && isValidEmergencyOverrideReason(emergencyReason)) return false;
  return true;
}

export async function getWeekScheduleState(
  actor: AuthedUser,
  locationId: string,
  weekKey: string,
): Promise<{
  weekKey: string;
  cutoffHours: number;
  weekRowStatus: "NONE" | "DRAFT" | "PUBLISHED";
  anyShiftLocked: boolean;
} | null> {
  if (!canManageLocation(actor, locationId)) {
    return null;
  }
  const weekKeyNorm = normalizeIsoWeekKey(weekKey);
  const location = await prisma.location.findUnique({ where: { id: locationId } });
  if (!location) throw new Error("LOCATION_NOT_FOUND");
  const weekStartDateLocal = weekStartDateLocalFromWeekKey(weekKeyNorm, location.tzIana);

  const sw = await prisma.scheduleWeek.findUnique({
    where: { locationId_weekStartDateLocal: { locationId, weekStartDateLocal } },
  });
  const cutoffHours = sw?.cutoffHours ?? 48;
  const weekRowStatus: "NONE" | "DRAFT" | "PUBLISHED" = !sw
    ? "NONE"
    : sw.status === "PUBLISHED"
      ? "PUBLISHED"
      : "DRAFT";

  /** When the week row is published, evaluate cutoff against every shift in the week (not only status=PUBLISHED) so we never miss rows due to weekKey/status drift. */
  let anyShiftLocked = false;
  if (sw?.status === "PUBLISHED") {
    const shiftsInWeek = await prisma.shift.findMany({
      where: {
        locationId,
        weekKey: { in: isoWeekKeyDbVariants(weekKeyNorm) },
      },
      select: { startAtUtc: true },
    });
    anyShiftLocked = anyShiftPastCutoff(cutoffHours, shiftsInWeek);
  }

  return { weekKey: weekKeyNorm, cutoffHours, weekRowStatus, anyShiftLocked };
}

export async function unpublishWeek(
  actor: AuthedUser,
  locationId: string,
  weekKey: string,
  opts?: UnpublishWeekOptions,
): Promise<{ weekKey: string; status: "DRAFT" } | null> {
  if (!canManageLocation(actor, locationId)) {
    return null;
  }
  const weekKeyNorm = normalizeIsoWeekKey(weekKey);
  const location = await prisma.location.findUnique({ where: { id: locationId } });
  if (!location) throw new Error("LOCATION_NOT_FOUND");
  const weekStartDateLocal = weekStartDateLocalFromWeekKey(weekKeyNorm, location.tzIana);

  const sw = await prisma.scheduleWeek.findUnique({
    where: { locationId_weekStartDateLocal: { locationId, weekStartDateLocal } },
  });
  const cutoffHours = sw?.cutoffHours ?? 48;

  if (sw?.status === "PUBLISHED") {
    const shiftsInWeek = await prisma.shift.findMany({
      where: {
        locationId,
        weekKey: { in: isoWeekKeyDbVariants(weekKeyNorm) },
      },
      select: { startAtUtc: true },
    });
    if (unpublishBlockedForActor(actor, cutoffHours, shiftsInWeek, opts?.emergencyOverrideReason)) {
      throw new Error("PAST_CUTOFF");
    }
  }

  const shiftRows = await prisma.shift.findMany({
    where: { locationId, weekKey: { in: isoWeekKeyDbVariants(weekKeyNorm) } },
    select: { id: true },
  });

  const afterJson: Prisma.InputJsonValue = {
    locationId,
    weekKey: weekKeyNorm,
    ...(opts?.emergencyOverrideReason && isValidEmergencyOverrideReason(opts.emergencyOverrideReason)
      ? { emergencyOverrideReason: opts.emergencyOverrideReason }
      : {}),
  } as Prisma.InputJsonValue;

  await prisma.$transaction(async (tx) => {
    await tx.scheduleWeek.updateMany({
      where: { locationId, weekStartDateLocal },
      data: { status: "DRAFT" },
    });
    await tx.shift.updateMany({
      where: { locationId, weekKey: { in: isoWeekKeyDbVariants(weekKeyNorm) } },
      data: { status: "DRAFT" },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: actor.id,
        entityType: "ScheduleWeek",
        entityId: `${locationId}:${weekKeyNorm}`,
        action: "UNPUBLISH",
        afterJson,
      },
    });
  });

  for (const row of shiftRows) {
    await cancelCoverageForShift(row.id, actor.id);
  }

  const assignments = await prisma.shiftAssignment.findMany({
    where: {
      shift: { locationId, weekKey: { in: isoWeekKeyDbVariants(weekKeyNorm) } },
      status: "ASSIGNED",
    },
    select: { staffUserId: true },
  });
  const notified = new Set<string>();
  for (const a of assignments) {
    if (notified.has(a.staffUserId)) continue;
    notified.add(a.staffUserId);
    await createNotification(a.staffUserId, "schedule.unpublished", {
      locationId,
      weekKey: weekKeyNorm,
      message: "Schedule has been unpublished; check for updates.",
    });
  }

  emitScheduleWeekUpdated(locationId, { weekKey: weekKeyNorm, status: "DRAFT" });
  return { weekKey: weekKeyNorm, status: "DRAFT" };
}
