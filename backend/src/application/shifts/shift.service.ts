import type { CreateShiftRequest, ShiftDto, UpdateShiftRequest } from "@shiftsync/shared";
import { compareIsoWeekKeys, isoWeekKeyDbVariants, normalizeIsoWeekKey } from "@shiftsync/shared";
import { DateTime } from "luxon";
import { weekStartDateLocalFromWeekKey } from "../../domain/scheduling/index.js";
import { shiftRecordToDto } from "../../domain/shifts/index.js";
import { prisma } from "../../infrastructure/persistence/index.js";
import { emitShiftUpdated } from "../../realtime/events.js";
import { canManageLocation, type AuthedUser } from "../../security/index.js";
import { cancelCoverageForShift } from "../coverage/index.js";

export async function listShiftsByLocationWeek(
  actor: AuthedUser,
  locationId: string,
  weekKey: string,
): Promise<ShiftDto[] | null> {
  if (!canManageLocation(actor, locationId)) {
    return null;
  }

  const keys = isoWeekKeyDbVariants(weekKey);
  const shifts = await prisma.shift.findMany({
    where: { locationId, weekKey: { in: keys } },
    orderBy: { startAtUtc: "asc" },
  });
  return shifts.map(shiftRecordToDto);
}

/** Published shifts at locations the staff member is certified for. */
export async function listPublishedShiftsForStaff(actor: AuthedUser, weekKey: string): Promise<ShiftDto[]> {
  if (actor.role !== "STAFF") return [];
  const certs = await prisma.staffCertification.findMany({
    where: { userId: actor.id },
    select: { locationId: true },
  });
  const locIds = certs.map((c) => c.locationId);
  if (locIds.length === 0) return [];
  const keys = isoWeekKeyDbVariants(weekKey);
  const shifts = await prisma.shift.findMany({
    where: { weekKey: { in: keys }, locationId: { in: locIds }, status: "PUBLISHED" },
    orderBy: { startAtUtc: "asc" },
  });
  return shifts.map(shiftRecordToDto);
}

export type ModifyShiftGate = { ok: true } | { ok: false; code: "NOT_FOUND" | "FORBIDDEN" | "PAST_CUTOFF" };
export type UpdateShiftError = "NOT_FOUND" | "FORBIDDEN" | "PAST_CUTOFF";

export async function canModifyShift(actor: AuthedUser, shiftId: string): Promise<ModifyShiftGate> {
  const shift = await prisma.shift.findUnique({ where: { id: shiftId }, include: { location: true } });
  if (!shift) return { ok: false, code: "NOT_FOUND" };
  if (!canManageLocation(actor, shift.locationId)) return { ok: false, code: "FORBIDDEN" };
  if (actor.role === "ADMIN") return { ok: true };
  if (shift.status === "DRAFT") return { ok: true };
  const weekStart = weekStartDateLocalFromWeekKey(shift.weekKey, shift.location.tzIana);
  const sw = await prisma.scheduleWeek.findUnique({
    where: { locationId_weekStartDateLocal: { locationId: shift.locationId, weekStartDateLocal: weekStart } },
  });
  const cutoffHours = sw?.cutoffHours ?? 48;
  const deadline = shift.startAtUtc.getTime() - cutoffHours * 60 * 60 * 1000;
  if (Date.now() > deadline) return { ok: false, code: "PAST_CUTOFF" };
  return { ok: true };
}

export async function createShift(actor: AuthedUser, input: CreateShiftRequest): Promise<ShiftDto | null> {
  if (!canManageLocation(actor, input.locationId)) {
    return null;
  }

  const start = new Date(input.startAtUtc);
  const end = new Date(input.endAtUtc);
  if (!(end > start)) {
    throw new Error("INVALID_RANGE");
  }

  const [location, skill] = await Promise.all([
    prisma.location.findUnique({ where: { id: input.locationId } }),
    prisma.skill.findUnique({ where: { id: input.requiredSkillId } }),
  ]);

  if (!location) throw new Error("LOCATION_NOT_FOUND");
  if (!skill) throw new Error("SKILL_NOT_FOUND");

  const inputWeek = normalizeIsoWeekKey(input.weekKey);
  const nowZ = DateTime.now().setZone(location.tzIana);
  const currentWeekKey = normalizeIsoWeekKey(`${nowZ.weekYear}-W${String(nowZ.weekNumber).padStart(2, "0")}`);
  if (compareIsoWeekKeys(inputWeek, currentWeekKey) < 0) {
    throw new Error("WEEK_IN_PAST");
  }

  const startLocal = DateTime.fromJSDate(start, { zone: "utc" }).setZone(location.tzIana);
  const todayStart = nowZ.startOf("day");
  if (startLocal < todayStart) {
    throw new Error("SHIFT_START_IN_PAST");
  }

  const created = await prisma.$transaction(async (tx) => {
    const shift = await tx.shift.create({
      data: {
        locationId: input.locationId,
        startAtUtc: start,
        endAtUtc: end,
        requiredSkillId: input.requiredSkillId,
        headcount: input.headcount,
        weekKey: input.weekKey,
        isPremium: input.isPremium ?? false,
        status: "DRAFT",
        createdById: actor.id,
      },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: actor.id,
        entityType: "Shift",
        entityId: shift.id,
        action: "CREATE",
        afterJson: shiftRecordToDto(shift) as object,
      },
    });

    return shift;
  });

  emitShiftUpdated(created.locationId, { shiftId: created.id, action: "created" });
  return shiftRecordToDto(created);
}

export async function updateShift(
  actor: AuthedUser,
  shiftId: string,
  patch: UpdateShiftRequest,
): Promise<ShiftDto | { error: UpdateShiftError }> {
  const gate = await canModifyShift(actor, shiftId);
  if (!gate.ok) {
    return { error: gate.code };
  }

  const existing = await prisma.shift.findUnique({ where: { id: shiftId } });
  if (!existing) return { error: "NOT_FOUND" };

  const start = patch.startAtUtc ? new Date(patch.startAtUtc) : existing.startAtUtc;
  const end = patch.endAtUtc ? new Date(patch.endAtUtc) : existing.endAtUtc;
  if (!(end > start)) {
    throw new Error("INVALID_RANGE");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const shift = await tx.shift.update({
      where: { id: shiftId },
      data: {
        startAtUtc: start,
        endAtUtc: end,
        headcount: patch.headcount ?? existing.headcount,
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: actor.id,
        entityType: "Shift",
        entityId: shift.id,
        action: "UPDATE",
        beforeJson: shiftRecordToDto(existing) as object,
        afterJson: shiftRecordToDto(shift) as object,
      },
    });
    return shift;
  });

  await cancelCoverageForShift(shiftId, actor.id);
  emitShiftUpdated(updated.locationId, { shiftId, action: "updated" });
  return shiftRecordToDto(updated);
}

export type DeleteShiftError = "NOT_FOUND" | "FORBIDDEN" | "PAST_CUTOFF";

export async function deleteShift(
  actor: AuthedUser,
  shiftId: string,
): Promise<{ ok: true } | { error: DeleteShiftError }> {
  const gate = await canModifyShift(actor, shiftId);
  if (!gate.ok) {
    return { error: gate.code };
  }

  const existing = await prisma.shift.findUnique({ where: { id: shiftId } });
  if (!existing) return { error: "NOT_FOUND" };

  await cancelCoverageForShift(shiftId, actor.id);

  await prisma.$transaction(async (tx) => {
    await tx.shift.delete({ where: { id: shiftId } });
    await tx.auditLog.create({
      data: {
        actorUserId: actor.id,
        entityType: "Shift",
        entityId: shiftId,
        action: "DELETE",
        beforeJson: shiftRecordToDto(existing) as object,
      },
    });
  });

  emitShiftUpdated(existing.locationId, { shiftId, action: "deleted" });
  return { ok: true };
}

export type ListAssignmentsResult =
  | { ok: true; rows: Array<{ assignmentId: string; staffUserId: string; staffName: string; staffEmail: string }> }
  | { ok: false; reason: "NOT_FOUND" | "FORBIDDEN" };

export async function listAssignmentsForShift(actor: AuthedUser, shiftId: string): Promise<ListAssignmentsResult> {
  const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
  if (!shift) return { ok: false, reason: "NOT_FOUND" };
  if (!canManageLocation(actor, shift.locationId)) return { ok: false, reason: "FORBIDDEN" };
  const rows = await prisma.shiftAssignment.findMany({
    where: { shiftId },
    include: { staff: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
  return {
    ok: true,
    rows: rows.map((r) => ({
      assignmentId: r.id,
      staffUserId: r.staff.id,
      staffName: r.staff.name,
      staffEmail: r.staff.email,
    })),
  };
}

