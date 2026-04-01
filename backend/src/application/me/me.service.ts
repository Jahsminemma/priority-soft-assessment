import { Prisma } from "@prisma/client";
import type { AvailabilityExceptionInput, NotificationPrefs } from "@shiftsync/shared";
import { prisma } from "../../infrastructure/persistence/index.js";
import { createNotification } from "../notifications/notification.service.js";

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
    },
  });
  await notifyManagersOfAvailabilityChange(userId);
  return { id: row.id };
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
