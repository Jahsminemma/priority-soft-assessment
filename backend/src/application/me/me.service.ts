import { Prisma } from "@prisma/client";
import type {
  AvailabilityExceptionBatchInput,
  AvailabilityExceptionInput,
  NotificationPrefs,
} from "@shiftsync/shared";
import { DateTime } from "luxon";
import { prisma } from "../../infrastructure/persistence/index.js";
import { createNotification } from "../notifications/notification.service.js";

function exceptionWallLocalToUtcIso(datetimeLocal: string, zone: string): string | null {
  const raw = datetimeLocal.trim();
  if (!raw) return null;
  const dt = DateTime.fromISO(raw, { zone });
  if (!dt.isValid) return null;
  return dt.toUTC().toISO() ?? null;
}

export async function getMyAvailability(userId: string): Promise<{
  rules: Array<{
    id: string;
    dayOfWeek: number;
    startLocalTime: string;
    endLocalTime: string;
  }>;
  exceptions: Array<{
    id: string;
    startAtUtc: Date;
    endAtUtc: Date;
    type: string;
    tzIana: string | null;
  }>;
}> {
  const [rules, exceptions] = await Promise.all([
    prisma.availabilityRule.findMany({ where: { userId }, orderBy: [{ dayOfWeek: "asc" }, { startLocalTime: "asc" }] }),
    prisma.availabilityException.findMany({ where: { userId }, orderBy: { startAtUtc: "asc" } }),
  ]);
  return { rules, exceptions };
}

async function notifyManagersOfAvailabilityChange(staffUserId: string): Promise<void> {
  const certs = await prisma.staffCertification.findMany({
    where: { userId: staffUserId },
    select: { locationId: true },
  });
  const seen = new Set<string>();
  for (const c of certs) {
    const managers = await prisma.managerLocation.findMany({
      where: { locationId: c.locationId },
      select: { userId: true },
    });
    for (const m of managers) {
      if (seen.has(m.userId)) continue;
      seen.add(m.userId);
      await createNotification(m.userId, "staff.availability_changed", {
        staffUserId,
        locationId: c.locationId,
      });
    }
  }
}

export async function replaceMyAvailabilityRules(
  userId: string,
  rules: Array<{ dayOfWeek: number; startLocalTime: string; endLocalTime: string }>,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.availabilityRule.deleteMany({ where: { userId } });
    if (rules.length > 0) {
      await tx.availabilityRule.createMany({
        data: rules.map((r) => ({
          userId,
          dayOfWeek: r.dayOfWeek,
          startLocalTime: r.startLocalTime,
          endLocalTime: r.endLocalTime,
        })),
      });
    }
  });
  await notifyManagersOfAvailabilityChange(userId);
}

export async function addMyAvailabilityException(
  userId: string,
  input: AvailabilityExceptionInput,
): Promise<{ id: string }> {
  const start = new Date(input.startAtUtc);
  const end = new Date(input.endAtUtc);
  if (!(end > start)) throw new Error("INVALID_RANGE");
  const row = await prisma.availabilityException.create({
    data: {
      userId,
      startAtUtc: start,
      endAtUtc: end,
      type: input.type,
      tzIana: input.tzIana ?? null,
    },
  });
  await notifyManagersOfAvailabilityChange(userId);
  return { id: row.id };
}

/**
 * Creates one exception per distinct (UTC range, type, tz) among the selected certified locations
 * (same wall times in each location’s zone; duplicates collapse when two sites share a timezone).
 */
export async function addMyAvailabilityExceptionsBatch(
  userId: string,
  input: AvailabilityExceptionBatchInput,
): Promise<{ ids: string[] }> {
  const uniqueLocationIds = [...new Set(input.locationIds)];
  const certs = await prisma.staffCertification.findMany({
    where: { userId, locationId: { in: uniqueLocationIds } },
    select: { locationId: true },
  });
  const allowed = new Set(certs.map((c) => c.locationId));
  for (const id of uniqueLocationIds) {
    if (!allowed.has(id)) throw new Error("INVALID_LOCATION");
  }

  const locations = await prisma.location.findMany({
    where: { id: { in: uniqueLocationIds } },
    select: { id: true, tzIana: true },
  });
  const tzByLocation = new Map(locations.map((l) => [l.id, l.tzIana]));

  type Row = { startAtUtc: Date; endAtUtc: Date; type: typeof input.type; tzIana: string };
  const pending: Row[] = [];
  const seen = new Set<string>();

  for (const locId of uniqueLocationIds) {
    const zone = tzByLocation.get(locId);
    if (!zone) throw new Error("INVALID_LOCATION");
    const startAtUtc = exceptionWallLocalToUtcIso(input.startLocal, zone);
    const endAtUtc = exceptionWallLocalToUtcIso(input.endLocal, zone);
    if (!startAtUtc || !endAtUtc) throw new Error("INVALID_LOCAL_TIME");
    if (new Date(endAtUtc) <= new Date(startAtUtc)) throw new Error("INVALID_RANGE");
    const key = `${startAtUtc}\0${endAtUtc}\0${input.type}\0${zone}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pending.push({
      startAtUtc: new Date(startAtUtc),
      endAtUtc: new Date(endAtUtc),
      type: input.type,
      tzIana: zone,
    });
  }

  if (pending.length === 0) {
    return { ids: [] };
  }

  const rows = await prisma.$transaction(
    pending.map((p) =>
      prisma.availabilityException.create({
        data: {
          userId,
          startAtUtc: p.startAtUtc,
          endAtUtc: p.endAtUtc,
          type: p.type,
          tzIana: p.tzIana,
        },
      }),
    ),
  );
  await notifyManagersOfAvailabilityChange(userId);
  return { ids: rows.map((r) => r.id) };
}

export async function deleteMyAvailabilityException(userId: string, exceptionId: string): Promise<boolean> {
  const r = await prisma.availabilityException.deleteMany({
    where: { id: exceptionId, userId },
  });
  if (r.count > 0) await notifyManagersOfAvailabilityChange(userId);
  return r.count > 0;
}

export async function getMyNotificationPrefs(userId: string): Promise<Record<string, unknown>> {
  const u = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { notificationPrefs: true },
  });
  return (u.notificationPrefs ?? {}) as Record<string, unknown>;
}

export async function patchMyNotificationPrefs(userId: string, patch: NotificationPrefs): Promise<Record<string, unknown>> {
  const u = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { notificationPrefs: true },
  });
  const prev = (u.notificationPrefs ?? {}) as Record<string, unknown>;
  const next = { ...prev, ...patch };
  await prisma.user.update({
    where: { id: userId },
    data: { notificationPrefs: next as Prisma.InputJsonValue },
  });
  return next;
}
