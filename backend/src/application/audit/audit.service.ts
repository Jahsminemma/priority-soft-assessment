import { prisma } from "../../infrastructure/persistence/index.js";
import { canManageLocation, type AuthedUser } from "../../security/index.js";
import { normalizeIsoWeekKey } from "@shiftsync/shared";

export type AuditLogRowDto = {
  id: string;
  actorUserId: string;
  actorName: string;
  entityType: string;
  entityId: string;
  action: string;
  beforeJson: unknown;
  afterJson: unknown;
  createdAt: string;
};

async function actorNameMap(actorUserIds: string[]): Promise<Map<string, string>> {
  if (actorUserIds.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(actorUserIds)] } },
    select: { id: true, name: true },
  });
  return new Map(users.map((u) => [u.id, u.name]));
}

function toDto(
  rows: Array<{
    id: string;
    actorUserId: string;
    entityType: string;
    entityId: string;
    action: string;
    beforeJson: unknown;
    afterJson: unknown;
    createdAt: Date;
  }>,
  names: Map<string, string>,
): AuditLogRowDto[] {
  return rows.map((r) => ({
    id: r.id,
    actorUserId: r.actorUserId,
    actorName: names.get(r.actorUserId) ?? "Unknown",
    entityType: r.entityType,
    entityId: r.entityId,
    action: r.action,
    beforeJson: r.beforeJson ?? null,
    afterJson: r.afterJson ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function listAuditForShift(actor: AuthedUser, shiftId: string): Promise<AuditLogRowDto[] | null> {
  const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
  if (!shift) return null;
  if (!canManageLocation(actor, shift.locationId)) return null;

  const weekKeyNorm = normalizeIsoWeekKey(shift.weekKey);
  const scheduleEntityId = `${shift.locationId}:${weekKeyNorm}`;

  const rows = await prisma.auditLog.findMany({
    where: {
      OR: [
        { entityType: "Shift", entityId: shiftId },
        { entityType: "ScheduleWeek", entityId: scheduleEntityId },
        {
          entityType: "ShiftAssignment",
          afterJson: { path: ["shiftId"], equals: shiftId },
        },
        {
          entityType: "ShiftAssignment",
          beforeJson: { path: ["shiftId"], equals: shiftId },
        },
        {
          entityType: "CoverageRequest",
          afterJson: { path: ["shiftId"], equals: shiftId },
        },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const names = await actorNameMap(rows.map((r) => r.actorUserId));
  return toDto(rows, names);
}

export async function exportAuditLogs(
  actor: AuthedUser,
  from: Date,
  to: Date,
  locationId?: string,
): Promise<AuditLogRowDto[] | null> {
  if (actor.role !== "ADMIN") return null;

  let rows: Array<{
    id: string;
    actorUserId: string;
    entityType: string;
    entityId: string;
    action: string;
    beforeJson: unknown;
    afterJson: unknown;
    createdAt: Date;
  }>;

  if (locationId) {
    const loc = await prisma.location.findUnique({ where: { id: locationId } });
    if (!loc) return [];

    const scheduleIdPrefix = `${locationId}:`;

    rows = await prisma.$queryRaw<
      Array<{
        id: string;
        actorUserId: string;
        entityType: string;
        entityId: string;
        action: string;
        beforeJson: unknown;
        afterJson: unknown;
        createdAt: Date;
      }>
    >`
      SELECT a.id, a."actorUserId", a."entityType", a."entityId", a.action, a."beforeJson", a."afterJson", a."createdAt"
      FROM "AuditLog" a
      WHERE a."createdAt" >= ${from}
        AND a."createdAt" <= ${to}
        AND (
          (a."entityType" = 'ScheduleWeek' AND a."entityId" LIKE ${`${scheduleIdPrefix}%`})
          OR (
            a."entityType" = 'Shift'
            AND a."entityId" IN (SELECT s.id FROM "Shift" s WHERE s."locationId" = ${locationId}::uuid)
          )
          OR (
            a."entityType" = 'ShiftAssignment'
            AND (
              (a."afterJson"->>'shiftId') IN (SELECT s.id::text FROM "Shift" s WHERE s."locationId" = ${locationId}::uuid)
              OR (a."beforeJson"->>'shiftId') IN (SELECT s.id::text FROM "Shift" s WHERE s."locationId" = ${locationId}::uuid)
            )
          )
        )
      ORDER BY a."createdAt" DESC
      LIMIT 5000
    `;
  } else {
    rows = await prisma.auditLog.findMany({
      where: { createdAt: { gte: from, lte: to } },
      orderBy: { createdAt: "desc" },
      take: 5000,
      select: {
        id: true,
        actorUserId: true,
        entityType: true,
        entityId: true,
        action: true,
        beforeJson: true,
        afterJson: true,
        createdAt: true,
      },
    });
  }

  const names = await actorNameMap(rows.map((r) => r.actorUserId));
  return toDto(rows, names);
}
