import type { Prisma } from "@prisma/client";
import type { CreateShiftRequest, ModifyShiftOptions, ShiftDto, UpdateShiftRequest } from "@shiftsync/shared";
import { isValidEmergencyOverrideReason } from "@shiftsync/shared";
import {
  compareIsoWeekKeys,
  isoWeekKeyDbVariants,
  normalizeIsoWeekKey,
  ShiftDtoSchema,
} from "@shiftsync/shared";
import { DateTime } from "luxon";
import {
  evaluateAssignmentConstraints,
  weekStartDateLocalFromWeekKey,
  type ConstraintContext,
  type ShiftIntervalInput,
} from "../../domain/scheduling/index.js";
import { shiftRecordToDto } from "../../domain/shifts/index.js";
import { prisma } from "../../infrastructure/persistence/index.js";
import { emitShiftUpdated } from "../../realtime/events.js";
import { canManageLocation, type AuthedUser } from "../../security/index.js";
import { cancelCoverageForShift } from "../coverage/index.js";
import { bumpScheduleContentRevision } from "../schedule/scheduleRevision.js";

/** DROP requests still in flight (not yet finalized by manager / claim). */
async function pendingDropRequestIdsByShiftForStaff(
  staffUserId: string,
  shiftIds: string[],
): Promise<Map<string, string>> {
  if (shiftIds.length === 0) return new Map();
  const rows = await prisma.coverageRequest.findMany({
    where: {
      requesterId: staffUserId,
      type: "DROP",
      status: { in: ["PENDING", "ACCEPTED"] },
      shiftId: { in: shiftIds },
    },
    select: { id: true, shiftId: true },
  });
  return new Map(rows.map((r) => [r.shiftId, r.id]));
}

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
    include: { _count: { select: { assignments: true } } },
  });
  return shifts.map((s) => shiftRecordToDto(s, { assignedCount: s._count.assignments }));
}

/** Published shifts this staff member is assigned to (and only for published weeks). */
export async function listPublishedShiftsForStaff(actor: AuthedUser, weekKey: string): Promise<ShiftDto[]> {
  if (actor.role !== "STAFF") return [];
  const weekKeyNorm = normalizeIsoWeekKey(weekKey);
  const locations = await prisma.location.findMany({ select: { id: true, tzIana: true } });
  if (locations.length === 0) return [];

  // Build an OR window per location to avoid relying on `shift.weekKey` (which can drift).
  const windows = locations.map((loc) => {
    const weekStartDateLocal = weekStartDateLocalFromWeekKey(weekKeyNorm, loc.tzIana);
    const weekStartAtLocal = DateTime.fromISO(`${weekStartDateLocal}T00:00:00`, { zone: loc.tzIana });
    const weekEndExclusiveLocal = weekStartAtLocal.plus({ days: 7 });
    return {
      locationId: loc.id,
      tzIana: loc.tzIana,
      weekStartDateLocal,
      startAtUtc: weekStartAtLocal.toUTC().toJSDate(),
      endAtUtc: weekEndExclusiveLocal.toUTC().toJSDate(),
    };
  });

  const assignments = await prisma.shiftAssignment.findMany({
    where: {
      staffUserId: actor.id,
      status: "ASSIGNED",
      OR: windows.map((w) => ({
        shift: {
          locationId: w.locationId,
          status: "PUBLISHED",
          startAtUtc: { gte: w.startAtUtc, lt: w.endAtUtc },
        },
      })),
    },
    include: { shift: { include: { location: true } } },
  });
  if (assignments.length === 0) return [];

  const byLocation = new Map<string, string>();
  for (const a of assignments) {
    if (byLocation.has(a.shift.locationId)) continue;
    byLocation.set(a.shift.locationId, weekStartDateLocalFromWeekKey(weekKeyNorm, a.shift.location.tzIana));
  }
  const publishedWeekTuples = [...byLocation.entries()].map(([locationId, weekStartDateLocal]) => ({
    locationId,
    weekStartDateLocal,
    status: "PUBLISHED" as const,
  }));
  const publishedWeeks = await prisma.scheduleWeek.findMany({
    where: { OR: publishedWeekTuples },
    select: { locationId: true },
  });
  const publishedLocationIds = new Set(publishedWeeks.map((w) => w.locationId));
  if (publishedLocationIds.size === 0) return [];

  const sorted = assignments
    .map((a) => a.shift)
    .filter((s) => publishedLocationIds.has(s.locationId))
    .sort((a, b) => a.startAtUtc.getTime() - b.startAtUtc.getTime());
  const shiftIds = [...new Set(sorted.map((s) => s.id))];
  const pendingByShift = await pendingDropRequestIdsByShiftForStaff(actor.id, shiftIds);
  return sorted.map((s) =>
    ShiftDtoSchema.parse({
      ...shiftRecordToDto(s),
      pendingDropRequestId: pendingByShift.get(s.id) ?? null,
    }),
  );
}

export type ModifyShiftGate = { ok: true } | { ok: false; code: "NOT_FOUND" | "FORBIDDEN" | "PAST_CUTOFF" };
export type UpdateShiftError = "NOT_FOUND" | "FORBIDDEN" | "PAST_CUTOFF";

async function buildConstraintContextForShiftTx(
  tx: Prisma.TransactionClient,
  staffUserId: string,
  shift: { id: string; locationId: string; requiredSkillId: string; startAtUtc: Date; endAtUtc: Date; locationTzIana: string },
): Promise<ConstraintContext> {
  const [staffUser, staffSkills, certs, rules, exceptions, assignments] = await Promise.all([
    tx.user.findUnique({ where: { id: staffUserId }, select: { name: true } }),
    tx.staffSkill.findMany({ where: { userId: staffUserId }, select: { skillId: true } }),
    tx.staffCertification.findMany({ where: { userId: staffUserId }, select: { locationId: true } }),
    tx.availabilityRule.findMany({ where: { userId: staffUserId } }),
    tx.availabilityException.findMany({ where: { userId: staffUserId } }),
    tx.shiftAssignment.findMany({
      where: {
        staffUserId,
        status: "ASSIGNED",
        shiftId: { not: shift.id },
      },
      include: { shift: { include: { location: true } } },
    }),
  ]);

  const otherAssignments: ShiftIntervalInput[] = assignments.map((a) => ({
    shiftId: a.shiftId,
    startAtUtc: a.shift.startAtUtc,
    endAtUtc: a.shift.endAtUtc,
    locationTzIana: a.shift.location.tzIana,
  }));

  const shiftInterval: ShiftIntervalInput = {
    shiftId: shift.id,
    startAtUtc: shift.startAtUtc,
    endAtUtc: shift.endAtUtc,
    locationTzIana: shift.locationTzIana,
  };

  return {
    locationId: shift.locationId,
    shift: shiftInterval,
    requiredSkillId: shift.requiredSkillId,
    staffUserId,
    ...(staffUser?.name ? { staffDisplayName: staffUser.name } : {}),
    staffSkillIds: staffSkills.map((s) => s.skillId),
    certifiedLocationIds: certs.map((c) => c.locationId),
    availabilityRules: rules.map((r) => ({
      dayOfWeek: r.dayOfWeek,
      startLocalTime: r.startLocalTime,
      endLocalTime: r.endLocalTime,
    })),
    availabilityExceptions: exceptions.map((x) => ({
      startAtUtc: x.startAtUtc,
      endAtUtc: x.endAtUtc,
      type: x.type,
    })),
    otherAssignments,
  };
}

export async function canModifyShift(
  actor: AuthedUser,
  shiftId: string,
  opts?: ModifyShiftOptions,
): Promise<ModifyShiftGate> {
  const shift = await prisma.shift.findUnique({ where: { id: shiftId }, include: { location: true } });
  if (!shift) return { ok: false, code: "NOT_FOUND" };
  if (!canManageLocation(actor, shift.locationId)) return { ok: false, code: "FORBIDDEN" };
  if (actor.role === "ADMIN") return { ok: true };

  const weekStart = weekStartDateLocalFromWeekKey(normalizeIsoWeekKey(shift.weekKey), shift.location.tzIana);
  const sw = await prisma.scheduleWeek.findUnique({
    where: { locationId_weekStartDateLocal: { locationId: shift.locationId, weekStartDateLocal: weekStart } },
  });

  /** Draft rows can exist in a published week (e.g. a shift added after publish). Gate on the week row, not shift.status. */
  if (sw?.status !== "PUBLISHED") {
    return { ok: true };
  }

  const cutoffHours = sw.cutoffHours ?? 48;
  const deadline = shift.startAtUtc.getTime() - cutoffHours * 60 * 60 * 1000;
  if (Date.now() > deadline) {
    if (actor.role === "MANAGER" && isValidEmergencyOverrideReason(opts?.emergencyOverrideReason)) {
      return { ok: true };
    }
    return { ok: false, code: "PAST_CUTOFF" };
  }
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
        weekKey: normalizeIsoWeekKey(input.weekKey),
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
  await bumpScheduleContentRevision(created.locationId, created.weekKey);
  return shiftRecordToDto(created);
}

export async function updateShift(
  actor: AuthedUser,
  shiftId: string,
  patch: UpdateShiftRequest,
): Promise<ShiftDto | { error: UpdateShiftError }> {
  const { emergencyOverrideReason, ...patchFields } = patch;
  const gate = await canModifyShift(actor, shiftId, { emergencyOverrideReason });
  if (!gate.ok) {
    return { error: gate.code };
  }

  const existing = await prisma.shift.findUnique({ where: { id: shiftId }, include: { location: true } });
  if (!existing) return { error: "NOT_FOUND" };

  const start = patchFields.startAtUtc ? new Date(patchFields.startAtUtc) : existing.startAtUtc;
  const end = patchFields.endAtUtc ? new Date(patchFields.endAtUtc) : existing.endAtUtc;
  if (!(end > start)) {
    throw new Error("INVALID_RANGE");
  }

  const assignedRows = await prisma.shiftAssignment.findMany({
    where: { shiftId, status: "ASSIGNED" },
    select: {
      staffUserId: true,
      staff: { select: { name: true } },
    },
  });
  if (assignedRows.length > 0) {
    const proposedShift = {
      id: shiftId,
      locationId: existing.locationId,
      requiredSkillId: existing.requiredSkillId,
      startAtUtc: start,
      endAtUtc: end,
      locationTzIana: existing.location.tzIana,
    };
    const firstViolation = await prisma.$transaction(async (tx) => {
      for (const row of assignedRows) {
        const ctx = await buildConstraintContextForShiftTx(tx, row.staffUserId, proposedShift);
        const { hard } = evaluateAssignmentConstraints(ctx, {});
        if (hard.length > 0) {
          const primary = hard[0]!;
          return {
            staffName: row.staff.name || "Assigned staff",
            reason: primary.message,
          };
        }
      }
      return null;
    });
    if (firstViolation) {
      throw new Error(`ASSIGNED_STAFF_CONSTRAINTS:${firstViolation.staffName}:${firstViolation.reason}`);
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const shift = await tx.shift.update({
      where: { id: shiftId },
      data: {
        startAtUtc: start,
        endAtUtc: end,
        headcount: patchFields.headcount ?? existing.headcount,
      },
    });
    const afterDto = shiftRecordToDto(shift) as object;
    const afterWithEmergency =
      emergencyOverrideReason && isValidEmergencyOverrideReason(emergencyOverrideReason)
        ? ({ ...afterDto, emergencyOverrideReason } as object)
        : afterDto;
    await tx.auditLog.create({
      data: {
        actorUserId: actor.id,
        entityType: "Shift",
        entityId: shift.id,
        action: "UPDATE",
        beforeJson: shiftRecordToDto(existing) as object,
        afterJson: afterWithEmergency,
      },
    });
    return shift;
  });

  await cancelCoverageForShift(shiftId, actor.id);
  emitShiftUpdated(updated.locationId, { shiftId, action: "updated" });
  await bumpScheduleContentRevision(updated.locationId, updated.weekKey);
  return shiftRecordToDto(updated);
}

export type DeleteShiftError = "NOT_FOUND" | "FORBIDDEN" | "PAST_CUTOFF";

export async function deleteShift(
  actor: AuthedUser,
  shiftId: string,
  opts?: ModifyShiftOptions,
): Promise<{ ok: true } | { error: DeleteShiftError }> {
  const gate = await canModifyShift(actor, shiftId, opts);
  if (!gate.ok) {
    return { error: gate.code };
  }

  const existing = await prisma.shift.findUnique({ where: { id: shiftId } });
  if (!existing) return { error: "NOT_FOUND" };

  await cancelCoverageForShift(shiftId, actor.id);

  await bumpScheduleContentRevision(existing.locationId, existing.weekKey);

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

type ShiftForStaffGate = {
  id: string;
  weekKey: string;
  locationId: string;
  status: string;
  location: { tzIana: string };
};

async function staffCanViewThisPublishedShift(actor: AuthedUser, shift: ShiftForStaffGate): Promise<boolean> {
  if (actor.role !== "STAFF") return false;
  if (shift.status !== "PUBLISHED") return false;
  const assigned = await prisma.shiftAssignment.findFirst({
    where: { shiftId: shift.id, staffUserId: actor.id, status: "ASSIGNED" },
  });
  if (!assigned) return false;
  const weekStartDateLocal = weekStartDateLocalFromWeekKey(
    normalizeIsoWeekKey(shift.weekKey),
    shift.location.tzIana,
  );
  const weekRow = await prisma.scheduleWeek.findFirst({
    where: {
      locationId: shift.locationId,
      weekStartDateLocal,
      status: "PUBLISHED",
    },
  });
  return weekRow != null;
}

export async function listAssignmentsForShift(actor: AuthedUser, shiftId: string): Promise<ListAssignmentsResult> {
  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
    include: { location: true },
  });
  if (!shift) return { ok: false, reason: "NOT_FOUND" };

  if (actor.role === "STAFF") {
    const ok = await staffCanViewThisPublishedShift(actor, shift);
    if (!ok) return { ok: false, reason: "FORBIDDEN" };
  } else if (!canManageLocation(actor, shift.locationId)) {
    return { ok: false, reason: "FORBIDDEN" };
  }

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

/** Single shift for dashboard / detail when the viewer is allowed to see it. */
export async function getShiftForViewer(actor: AuthedUser, shiftId: string): Promise<ShiftDto | null> {
  const row = await prisma.shift.findUnique({
    where: { id: shiftId },
    include: { location: true, _count: { select: { assignments: true } } },
  });
  if (!row) return null;

  if (actor.role === "STAFF") {
    const ok = await staffCanViewThisPublishedShift(actor, row);
    if (!ok) return null;
    const pendingDrop = await prisma.coverageRequest.findFirst({
      where: {
        requesterId: actor.id,
        shiftId,
        type: "DROP",
        status: { in: ["PENDING", "ACCEPTED"] },
      },
      select: { id: true },
    });
    return ShiftDtoSchema.parse({
      ...shiftRecordToDto(row),
      pendingDropRequestId: pendingDrop?.id ?? null,
    });
  }

  if (!canManageLocation(actor, row.locationId)) return null;
  return ShiftDtoSchema.parse(shiftRecordToDto(row, { assignedCount: row._count.assignments }));
}

