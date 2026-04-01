import { Prisma } from "@prisma/client";
import { weekStartDateLocalFromWeekKey } from "../../domain/scheduling/index.js";
import { prisma } from "../../infrastructure/persistence/index.js";
import { emitScheduleWeekUpdated } from "../../realtime/events.js";
import { canManageLocation, type AuthedUser } from "../../security/index.js";

export async function publishWeek(
  actor: AuthedUser,
  locationId: string,
  weekKey: string,
  cutoffHours?: number,
): Promise<{ weekKey: string; status: "PUBLISHED" } | null> {
  if (!canManageLocation(actor, locationId)) {
    return null;
  }
  
  const location = await prisma.location.findUnique({ where: { id: locationId } });
  if (!location) throw new Error("LOCATION_NOT_FOUND");
  const weekStartDateLocal = weekStartDateLocalFromWeekKey(weekKey, location.tzIana);
  const cutoff = cutoffHours ?? 48;

  await prisma.$transaction(async (tx) => {
    await tx.scheduleWeek.upsert({
      where: { locationId_weekStartDateLocal: { locationId, weekStartDateLocal } },
      create: { locationId, weekStartDateLocal, status: "PUBLISHED", cutoffHours: cutoff },
      update: { status: "PUBLISHED", cutoffHours: cutoff },
    });
    await tx.shift.updateMany({
      where: { locationId, weekKey },
      data: { status: "PUBLISHED" },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: actor.id,
        entityType: "ScheduleWeek",
        entityId: `${locationId}:${weekKey}`,
        action: "PUBLISH",
        afterJson: { locationId, weekKey, cutoffHours: cutoff } as Prisma.InputJsonValue,
      },
    });
  });

  emitScheduleWeekUpdated(locationId, { weekKey, status: "PUBLISHED" });
  return { weekKey, status: "PUBLISHED" };
}

export async function unpublishWeek(
  actor: AuthedUser,
  locationId: string,
  weekKey: string,
): Promise<{ weekKey: string; status: "DRAFT" } | null> {
  if (!canManageLocation(actor, locationId)) {
    return null;
  }
  const location = await prisma.location.findUnique({ where: { id: locationId } });
  if (!location) throw new Error("LOCATION_NOT_FOUND");
  const weekStartDateLocal = weekStartDateLocalFromWeekKey(weekKey, location.tzIana);

  await prisma.$transaction(async (tx) => {
    await tx.scheduleWeek.updateMany({
      where: { locationId, weekStartDateLocal },
      data: { status: "DRAFT" },
    });
    await tx.shift.updateMany({
      where: { locationId, weekKey },
      data: { status: "DRAFT" },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: actor.id,
        entityType: "ScheduleWeek",
        entityId: `${locationId}:${weekKey}`,
        action: "UNPUBLISH",
        afterJson: { locationId, weekKey } as Prisma.InputJsonValue,
      },
    });
  });

  emitScheduleWeekUpdated(locationId, { weekKey, status: "DRAFT" });
  return { weekKey, status: "DRAFT" };
}
