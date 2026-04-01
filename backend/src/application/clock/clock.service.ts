import { prisma } from "../../infrastructure/persistence/index.js";
import { emitPresenceOnDutyUpdated } from "../../realtime/events.js";

export async function clockIn(staffUserId: string, shiftId: string): Promise<{ sessionId: string }> {
  const assignment = await prisma.shiftAssignment.findFirst({
    where: { shiftId, staffUserId, status: "ASSIGNED" },
    include: { shift: { include: { location: true } } },
  });
  if (!assignment) throw new Error("NOT_ASSIGNED_TO_SHIFT");

  const now = new Date();
  const { shift } = assignment;
  if (now > shift.endAtUtc) throw new Error("SHIFT_ENDED");

  const open = await prisma.clockSession.findFirst({
    where: { staffUserId, clockOutAtUtc: null },
  });
  if (open) throw new Error("ALREADY_CLOCKED_IN");

  const session = await prisma.clockSession.create({
    data: {
      staffUserId,
      shiftId,
      clockInAtUtc: now,
    },
  });

  emitPresenceOnDutyUpdated(shift.locationId, { locationId: shift.locationId });
  return { sessionId: session.id };
}

export async function clockOut(staffUserId: string): Promise<{ sessionId: string }> {
  const open = await prisma.clockSession.findFirst({
    where: { staffUserId, clockOutAtUtc: null },
    orderBy: { clockInAtUtc: "desc" },
    include: { shift: { select: { locationId: true } } },
  });
  if (!open) throw new Error("NO_OPEN_SESSION");

  const locationId = open.shift?.locationId;
  await prisma.clockSession.update({
    where: { id: open.id },
    data: { clockOutAtUtc: new Date() },
  });

  if (locationId) {
    emitPresenceOnDutyUpdated(locationId, { locationId });
  }
  return { sessionId: open.id };
}

export type OnDutyRow = {
  sessionId: string;
  staffUserId: string;
  staffName: string;
  shiftId: string | null;
  clockInAtUtc: string;
  shiftStartAtUtc: string | null;
  shiftEndAtUtc: string | null;
};

export async function listOnDutyForLocation(locationId: string): Promise<OnDutyRow[]> {
  const sessions = await prisma.clockSession.findMany({
    where: {
      clockOutAtUtc: null,
      shift: { locationId },
    },
    include: {
      staff: { select: { id: true, name: true } },
      shift: { select: { id: true, startAtUtc: true, endAtUtc: true } },
    },
    orderBy: { clockInAtUtc: "asc" },
  });

  return sessions.map((s) => ({
    sessionId: s.id,
    staffUserId: s.staff.id,
    staffName: s.staff.name,
    shiftId: s.shift?.id ?? null,
    clockInAtUtc: s.clockInAtUtc.toISOString(),
    shiftStartAtUtc: s.shift?.startAtUtc.toISOString() ?? null,
    shiftEndAtUtc: s.shift?.endAtUtc.toISOString() ?? null,
  }));
}
