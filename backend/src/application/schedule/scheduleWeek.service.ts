import { Prisma } from "@prisma/client";
import { isValidEmergencyOverrideReason, isoWeekKeyDbVariants, normalizeIsoWeekKey } from "@shiftsync/shared";
import { DateTime } from "luxon";
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
  const weekStartAtLocal = DateTime.fromISO(`${weekStartDateLocal}T00:00:00`, { zone: location.tzIana });
  const weekEndExclusiveLocal = weekStartAtLocal.plus({ days: 7 });
  const weekStartUtc = weekStartAtLocal.toUTC().toJSDate();
  const weekEndUtc = weekEndExclusiveLocal.toUTC().toJSDate();
  const locationName = location.name;
  let publishKind: "published" | "updated" = "published";

  await prisma.$transaction(async (tx) => {
    // NOTE: Prisma client types can lag behind migrations in some editor environments.
    // At runtime these fields exist (see migration), so we cast to keep TS diagnostics stable.
    const existing: any = await tx.scheduleWeek.findUnique({
      where: { locationId_weekStartDateLocal: { locationId, weekStartDateLocal } },
    });
    if (
      existing?.status === "PUBLISHED" &&
      existing.scheduleContentRevision === existing.publishedContentRevision
    ) {
      throw new Error("PUBLISH_NOTHING_NEW");
    }
    // Publish based on actual local-week window, not `weekKey` (which can drift if older data was created incorrectly).
    await tx.shift.updateMany({
      where: {
        locationId,
        startAtUtc: { gte: weekStartUtc, lt: weekEndUtc },
      },
      data: { status: "PUBLISHED" },
    });
    if (existing) {
      if (existing.status === "PUBLISHED") publishKind = "updated";
      await (tx.scheduleWeek as any).update({
        where: { id: existing.id },
        data: {
          status: "PUBLISHED",
          cutoffHours: cutoff,
          publishedContentRevision: existing.scheduleContentRevision,
        },
      });
    } else {
      await tx.scheduleWeek.create({
        data: {
          locationId,
          weekStartDateLocal,
          status: "PUBLISHED",
          cutoffHours: cutoff,
        },
      });
    }
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

  // Notify assigned staff that a schedule week was published/updated.
  const assignments = await prisma.shiftAssignment.findMany({
    where: {
      status: "ASSIGNED",
      shift: {
        locationId,
        status: "PUBLISHED",
        startAtUtc: { gte: weekStartUtc, lt: weekEndUtc },
      },
    },
    select: { staffUserId: true },
  });
  const notified = new Set<string>();
  for (const a of assignments) {
    if (notified.has(a.staffUserId)) continue;
    notified.add(a.staffUserId);
    await createNotification(a.staffUserId, "schedule.published", {
      locationId,
      locationName,
      weekKey: weekKeyNorm,
      kind: publishKind,
    });
  }

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
  publishDisabled: boolean;
} | null> {
  if (!canManageLocation(actor, locationId)) {
    return null;
  }
  const weekKeyNorm = normalizeIsoWeekKey(weekKey);
  const location = await prisma.location.findUnique({ where: { id: locationId } });
  if (!location) throw new Error("LOCATION_NOT_FOUND");
  const weekStartDateLocal = weekStartDateLocalFromWeekKey(weekKeyNorm, location.tzIana);

  const sw: any = await prisma.scheduleWeek.findUnique({
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
    const shiftsCandidates = await prisma.shift.findMany({
      where: {
        locationId,
        weekKey: { in: isoWeekKeyDbVariants(weekKeyNorm) },
      },
      select: { startAtUtc: true },
    });
    if (shiftsCandidates.length > 0) {
      const weekStartAtLocal = DateTime.fromISO(`${weekStartDateLocal}T00:00:00`, { zone: location.tzIana });
      const weekEndExclusive = weekStartAtLocal.plus({ days: 7 });
      const shiftsInActualWeek = shiftsCandidates.filter((s) => {
        const localStart = DateTime.fromJSDate(s.startAtUtc).setZone(location.tzIana);
        return localStart >= weekStartAtLocal && localStart < weekEndExclusive;
      });
      anyShiftLocked = anyShiftPastCutoff(cutoffHours, shiftsInActualWeek);
    }
  }

  const publishDisabled =
    sw != null &&
    sw.status === "PUBLISHED" &&
    sw.scheduleContentRevision === sw.publishedContentRevision;

  return { weekKey: weekKeyNorm, cutoffHours, weekRowStatus, anyShiftLocked, publishDisabled };
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
  const locationName = location.name;
  const weekStartAtLocal = DateTime.fromISO(`${weekStartDateLocal}T00:00:00`, { zone: location.tzIana });
  const weekEndExclusiveLocal = weekStartAtLocal.plus({ days: 7 });
  const weekStartUtc = weekStartAtLocal.toUTC().toJSDate();
  const weekEndUtc = weekEndExclusiveLocal.toUTC().toJSDate();

  const sw = await prisma.scheduleWeek.findUnique({
    where: { locationId_weekStartDateLocal: { locationId, weekStartDateLocal } },
  });
  const cutoffHours = sw?.cutoffHours ?? 48;

  if (sw?.status === "PUBLISHED") {
    const shiftsCandidates = await prisma.shift.findMany({
      where: {
        locationId,
        weekKey: { in: isoWeekKeyDbVariants(weekKeyNorm) },
      },
      select: { startAtUtc: true },
    });
    const weekStartAtLocal = DateTime.fromISO(`${weekStartDateLocal}T00:00:00`, { zone: location.tzIana });
    const weekEndExclusive = weekStartAtLocal.plus({ days: 7 });
    const shiftsInActualWeek = shiftsCandidates.filter((s) => {
      const localStart = DateTime.fromJSDate(s.startAtUtc).setZone(location.tzIana);
      return localStart >= weekStartAtLocal && localStart < weekEndExclusive;
    });
    if (unpublishBlockedForActor(actor, cutoffHours, shiftsInActualWeek, opts?.emergencyOverrideReason)) {
      throw new Error("PAST_CUTOFF");
    }
  }

  const shiftRows = await prisma.shift.findMany({
    where: { locationId, startAtUtc: { gte: weekStartUtc, lt: weekEndUtc } },
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
        where: { locationId, startAtUtc: { gte: weekStartUtc, lt: weekEndUtc } },
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
      shift: { locationId, startAtUtc: { gte: weekStartUtc, lt: weekEndUtc } },
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
      locationName,
      weekKey: weekKeyNorm,
      message: "Schedule has been unpublished; check for updates.",
    });
  }

  emitScheduleWeekUpdated(locationId, { weekKey: weekKeyNorm, status: "DRAFT" });
  return { weekKey: weekKeyNorm, status: "DRAFT" };
}
