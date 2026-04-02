import { prisma } from "../../infrastructure/persistence/index.js";
import { canManageLocation, type AuthedUser } from "../../security/index.js";

export async function listAuditForShift(
  actor: AuthedUser,
  shiftId: string,
): Promise<
  | Array<{
      id: string;
      actorUserId: string;
      entityType: string;
      entityId: string;
      action: string;
      beforeJson: unknown;
      afterJson: unknown;
      createdAt: Date;
    }>
  | null
> {
  const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
  if (!shift) return null;
  if (!canManageLocation(actor, shift.locationId)) return null;

  return prisma.auditLog.findMany({
    where: {
      OR: [
        { entityType: "Shift", entityId: shiftId },
        {
          entityType: "ShiftAssignment",
          afterJson: { path: ["shiftId"], equals: shiftId },
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
}

export async function exportAuditLogs(
  actor: AuthedUser,
  from: Date,
  to: Date,
): Promise<
  | Array<{
      id: string;
      actorUserId: string;
      entityType: string;
      entityId: string;
      action: string;
      beforeJson: unknown;
      afterJson: unknown;
      createdAt: Date;
    }>
  | null
> {
  if (actor.role !== "ADMIN") return null;
  return prisma.auditLog.findMany({
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
