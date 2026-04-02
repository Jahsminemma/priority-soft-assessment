import { Prisma } from "@prisma/client";
import type {
  AssignmentCommitResponse,
  AssignmentPreviewResponse,
  ModifyShiftOptions,
} from "@shiftsync/shared";
import { CONSTRAINT_RULE_TITLES, isoWeekKeyDbVariants, normalizeIsoWeekKey } from "@shiftsync/shared";
import {
  evaluateAssignmentConstraints,
  weekStartDateLocalFromWeekKey,
  type ConstraintContext,
  type ShiftIntervalInput,
} from "../../domain/scheduling/index.js";
import { prisma } from "../../infrastructure/persistence/index.js";
import { emitAssignmentChanged, emitAssignmentConflict } from "../../realtime/events.js";
import { canModifyShift } from "../shifts/shift.service.js";
import { createNotification } from "../notifications/notification.service.js";
import type { AuthedUser } from "../../security/index.js";

function gateResponseFromModifyShift(
  gate: Awaited<ReturnType<typeof canModifyShift>>,
): AssignmentPreviewResponse | null {
  if (gate.ok) return null;
  if (gate.code === "PAST_CUTOFF") {
    return {
      ok: false,
      hardViolations: [
        {
          code: "SCHEDULE_CUTOFF",
          message:
            "This schedule is locked: we are within the edit cutoff before this shift (default: 48 hours). For urgent changes, use the emergency coverage workflow: add emergencyOverrideReason (min. 10 characters) on the request, or ask an administrator.",
          severity: "hard",
        },
      ],
      warnings: [],
      alternatives: [],
      ineligibleCandidates: [],
    };
  }
  return {
    ok: false,
    hardViolations: [
      {
        code: "SHIFT_NOT_FOUND",
        message:
          gate.code === "FORBIDDEN"
            ? "You can’t manage assignments for this location."
            : "This shift no longer exists. Refresh the schedule and try again.",
        severity: "hard",
      },
    ],
    warnings: [],
    alternatives: [],
    ineligibleCandidates: [],
  };
}

export async function previewAssignment(
  shiftId: string,
  staffUserId: string,
  actor: AuthedUser,
  modifyOpts?: ModifyShiftOptions,
): Promise<AssignmentPreviewResponse> {
  const shiftSlot = await prisma.shift.findUnique({
    where: { id: shiftId },
    include: { _count: { select: { assignments: true } } },
  });
  if (!shiftSlot) {
    return {
      ok: false,
      hardViolations: [
        {
          code: "SHIFT_NOT_FOUND",
          message: "This shift no longer exists. Refresh the schedule and try again.",
          severity: "hard",
        },
      ],
      warnings: [],
      alternatives: [],
      ineligibleCandidates: [],
    };
  }
  const gate = await canModifyShift(actor, shiftId, modifyOpts);
  const gated = gateResponseFromModifyShift(gate);
  if (gated) return gated;

  if (shiftSlot._count.assignments >= shiftSlot.headcount) {
    return {
      ok: false,
      hardViolations: [
        {
          code: "HEADCOUNT_FULL",
          message: `This shift is already fully staffed (${shiftSlot.headcount} of ${shiftSlot.headcount} slots).`,
          severity: "hard",
        },
      ],
      warnings: [],
      alternatives: [],
      ineligibleCandidates: [],
    };
  }

  const constraintContext = await buildConstraintContext(shiftId, staffUserId);
  const { hard, warnings } = evaluateAssignmentConstraints(constraintContext, {});
  const ok = hard.length === 0;
  const alternatives = ok ? [] : await findAlternatives(shiftId, 5);
  const eligibleIds = new Set(alternatives.map((a) => a.staffUserId));
  const ineligibleCandidates = ok
    ? []
    : await findIneligibleCandidates(shiftId, staffUserId, eligibleIds, 6);
  return {
    ok,
    hardViolations: hard,
    warnings,
    alternatives,
    ineligibleCandidates,
  };
}

export async function removeAssignment(
  assignmentId: string,
  actor: AuthedUser,
  modifyOpts?: ModifyShiftOptions,
): Promise<{ ok: true } | { ok: false; reason: "NOT_FOUND" | "FORBIDDEN" | "PAST_CUTOFF" }> {
  const row = await prisma.shiftAssignment.findUnique({
    where: { id: assignmentId },
    include: { shift: { select: { id: true, locationId: true } } },
  });
  if (!row) return { ok: false, reason: "NOT_FOUND" };

  const gate = await canModifyShift(actor, row.shiftId, modifyOpts);
  if (!gate.ok) {
    if (gate.code === "PAST_CUTOFF") return { ok: false, reason: "PAST_CUTOFF" };
    return { ok: false, reason: "FORBIDDEN" };
  }

  await prisma.$transaction(async (tx) => {
    await tx.shiftAssignment.delete({ where: { id: assignmentId } });
    await tx.auditLog.create({
      data: {
        actorUserId: actor.id,
        entityType: "ShiftAssignment",
        entityId: assignmentId,
        action: "DELETE",
        beforeJson: { shiftId: row.shiftId, staffUserId: row.staffUserId } as Prisma.InputJsonValue,
      },
    });
  });

  emitAssignmentChanged(row.shift.locationId, {
    shiftId: row.shiftId,
    staffUserId: row.staffUserId,
    assignmentId,
  });

  return { ok: true };
}

export async function commitAssignment(
  shiftId: string,
  staffUserId: string,
  idempotencyKey: string,
  seventhDayOverrideReason: string | undefined,
  actor: AuthedUser,
  modifyOpts?: ModifyShiftOptions,
): Promise<AssignmentCommitResponse> {
  const existing = await prisma.idempotencyKey.findUnique({ where: { key: idempotencyKey } });
  if (existing) {
    return JSON.parse(JSON.stringify(existing.resultJson)) as AssignmentCommitResponse;
  }

  const shiftSlot = await prisma.shift.findUnique({
    where: { id: shiftId },
    include: { _count: { select: { assignments: true } } },
  });
  if (!shiftSlot) {
    return {
      success: false,
      hardViolations: [],
      warnings: [],
      conflict: true,
      message: "Shift not found.",
    };
  }

  const modifyGate = await canModifyShift(actor, shiftId, modifyOpts);
  if (!modifyGate.ok) {
    if (modifyGate.code === "PAST_CUTOFF") {
      return {
        success: false,
        hardViolations: [
          {
            code: "SCHEDULE_CUTOFF",
            message:
              "This schedule is locked within the edit cutoff before this shift. For urgent changes, use emergency coverage with emergencyOverrideReason on the request, or ask an administrator.",
            severity: "hard",
          },
        ],
        warnings: [],
      };
    }
    return {
      success: false,
      hardViolations: [
        {
          code: "SHIFT_NOT_FOUND",
          message:
            modifyGate.code === "FORBIDDEN"
              ? "You can’t manage assignments for this location."
              : "Shift not found.",
          severity: "hard",
        },
      ],
      warnings: [],
    };
  }

  if (shiftSlot._count.assignments >= shiftSlot.headcount) {
    return {
      success: false,
      hardViolations: [
        {
          code: "HEADCOUNT_FULL",
          message: `This shift is already fully staffed (${shiftSlot.headcount} of ${shiftSlot.headcount} slots). Remove someone or raise headcount to add another person.`,
          severity: "hard",
        },
      ],
      warnings: [],
    };
  }

  const constraintContext = await buildConstraintContext(shiftId, staffUserId);
  const { hard, warnings } = evaluateAssignmentConstraints(constraintContext, { seventhDayOverrideReason });

  if (hard.length > 0) {
    const alternatives = await findAlternatives(shiftId, 5);
    const eligibleIds = new Set(alternatives.map((a) => a.staffUserId));
    const ineligibleCandidates = await findIneligibleCandidates(shiftId, staffUserId, eligibleIds, 6);
    const res: AssignmentCommitResponse = {
      success: false,
      hardViolations: hard,
      warnings,
      alternatives,
      ineligibleCandidates,
    };
    return res;
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.user.findUniqueOrThrow({ where: { id: staffUserId } });

      const created = await tx.shiftAssignment.create({
        data: {
          shiftId,
          staffUserId,
          status: "ASSIGNED",
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: actor.id,
          entityType: "ShiftAssignment",
          entityId: created.id,
          action: "CREATE",
          afterJson: { shiftId, staffUserId } as Prisma.InputJsonValue,
        },
      });

      return created;
    });

    const res: AssignmentCommitResponse = {
      success: true,
      assignmentId: result.id,
      hardViolations: [],
      warnings,
    };

    await prisma.idempotencyKey.create({
      data: { key: idempotencyKey, resultJson: res as Prisma.InputJsonValue },
    });

    const shiftRow = await prisma.shift.findUniqueOrThrow({
      where: { id: shiftId },
      select: {
        locationId: true,
        startAtUtc: true,
        endAtUtc: true,
        weekKey: true,
        location: { select: { tzIana: true } },
      },
    });
    emitAssignmentChanged(shiftRow.locationId, {
      shiftId,
      staffUserId,
      assignmentId: result.id,
    });

    const weekStartDateLocal = weekStartDateLocalFromWeekKey(shiftRow.weekKey, shiftRow.location.tzIana);
    const scheduleWeek = await prisma.scheduleWeek.findUnique({
      where: {
        locationId_weekStartDateLocal: {
          locationId: shiftRow.locationId,
          weekStartDateLocal,
        },
      },
      select: { status: true },
    });
    if (scheduleWeek?.status === "PUBLISHED") {
      await createNotification(staffUserId, "assignment.created", {
        shiftId,
        assignmentId: result.id,
        locationId: shiftRow.locationId,
        weekKey: shiftRow.weekKey,
        startAtUtc: shiftRow.startAtUtc.toISOString(),
        endAtUtc: shiftRow.endAtUtc.toISOString(),
      });
    }

    return res;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const loc = await prisma.shift.findUnique({ where: { id: shiftId }, select: { locationId: true } });
      if (loc) {
        emitAssignmentConflict(loc.locationId, {
          shiftId,
          message: "Assignment conflict — staff may already be assigned to this shift.",
        });
      }
      return {
        success: false,
        hardViolations: [],
        warnings: [],
        conflict: true,
        message: "Assignment conflict — staff may already be assigned to this shift.",
      };
    }
    throw e;
  }
}

export async function buildConstraintContext(
  shiftId: string,
  staffUserId: string,
): Promise<ConstraintContext> {
  const shift = await prisma.shift.findUniqueOrThrow({
    where: { id: shiftId },
    include: { location: true, requiredSkill: true },
  });

  const staffUser = await prisma.user.findUnique({
    where: { id: staffUserId },
    select: { name: true },
  });

  const staffSkills = await prisma.staffSkill.findMany({
    where: { userId: staffUserId },
    select: { skillId: true },
  });

  const certs = await prisma.staffCertification.findMany({
    where: { userId: staffUserId },
    select: { locationId: true },
  });

  const rules = await prisma.availabilityRule.findMany({
    where: { userId: staffUserId },
  });

  const exceptions = await prisma.availabilityException.findMany({
    where: { userId: staffUserId },
  });

  const assignments = await prisma.shiftAssignment.findMany({
    where: {
      staffUserId,
      shiftId: { not: shiftId },
    },
    include: { shift: { include: { location: true } } },
  });

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
    locationTzIana: shift.location.tzIana,
  };

  return {
    locationId: shift.locationId,
    shift: shiftInterval,
    requiredSkillId: shift.requiredSkillId,
    staffUserId,
    ...(staffUser?.name != null && staffUser.name.trim() !== ""
      ? { staffDisplayName: staffUser.name.trim() }
      : {}),
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

const SWAP_PAIR_LIMIT = 40;

export type SwapPairCandidate = {
  staffUserId: string;
  staffName: string;
  secondShiftId: string;
  theirShiftSkillName: string;
  theirShiftStartAtUtc: string;
  theirShiftEndAtUtc: string;
};

/**
 * True two-way swap options: another staff member who already holds a published shift at the same
 * location in the same schedule week, where (1) they could take your shift and (2) you could take
 * theirs, with no hard constraint violations either way (skills, site cert, availability, rest,
 * overlaps, unavailable/leave exceptions). Coworkers on the same shift are excluded.
 */
export async function listSwapCandidatesForAssignedStaff(
  actor: AuthedUser,
  shiftId: string,
): Promise<
  | {
      ok: true;
      candidates: SwapPairCandidate[];
      hasPendingSwapRequest: boolean;
      locationTzIana: string;
    }
  | { ok: false; reason: "NOT_FOUND" | "NOT_ASSIGNED" }
> {
  if (actor.role !== "STAFF") {
    return { ok: false, reason: "NOT_FOUND" };
  }

  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
    include: { location: true },
  });
  if (!shift) return { ok: false, reason: "NOT_FOUND" };

  const assignment = await prisma.shiftAssignment.findFirst({
    where: { shiftId, staffUserId: actor.id, status: "ASSIGNED" },
  });
  if (!assignment) return { ok: false, reason: "NOT_ASSIGNED" };

  const pendingSwap = await prisma.coverageRequest.findFirst({
    where: {
      requesterId: actor.id,
      shiftId,
      type: "SWAP",
      status: { in: ["PENDING", "ACCEPTED"] },
    },
    select: { id: true },
  });
  const hasPendingSwapRequest = pendingSwap != null;

  const onShift = await prisma.shiftAssignment.findMany({
    where: { shiftId, status: "ASSIGNED" },
    select: { staffUserId: true },
  });
  const alreadyOnShift = new Set(onShift.map((r) => r.staffUserId));

  const weekKeys = isoWeekKeyDbVariants(normalizeIsoWeekKey(shift.weekKey));

  const peerAssignments = await prisma.shiftAssignment.findMany({
    where: {
      staffUserId: { not: actor.id },
      status: "ASSIGNED",
      shift: {
        locationId: shift.locationId,
        weekKey: { in: weekKeys },
        id: { not: shiftId },
        status: "PUBLISHED",
      },
    },
    include: {
      shift: { include: { location: true, requiredSkill: true } },
      staff: { select: { id: true, name: true } },
    },
  });

  const out: SwapPairCandidate[] = [];
  for (const row of peerAssignments) {
    const peerId = row.staffUserId;
    if (alreadyOnShift.has(peerId)) continue;

    const theirShift = row.shift;
    const ctxTheyTakeMine = await buildConstraintContext(shiftId, peerId);
    if (evaluateAssignmentConstraints(ctxTheyTakeMine, {}).hard.length > 0) continue;

    const ctxITakeTheirs = await buildConstraintContext(theirShift.id, actor.id);
    if (evaluateAssignmentConstraints(ctxITakeTheirs, {}).hard.length > 0) continue;

    const staffName = row.staff.name?.trim() ? row.staff.name.trim() : "Teammate";
    out.push({
      staffUserId: peerId,
      staffName,
      secondShiftId: theirShift.id,
      theirShiftSkillName: theirShift.requiredSkill.name,
      theirShiftStartAtUtc: theirShift.startAtUtc.toISOString(),
      theirShiftEndAtUtc: theirShift.endAtUtc.toISOString(),
    });
    if (out.length >= SWAP_PAIR_LIMIT) break;
  }

  out.sort((a, b) => {
    const t = a.theirShiftStartAtUtc.localeCompare(b.theirShiftStartAtUtc);
    return t !== 0 ? t : a.staffName.localeCompare(b.staffName);
  });

  return {
    ok: true,
    candidates: out,
    hasPendingSwapRequest,
    locationTzIana: shift.location.tzIana,
  };
}

async function findAlternatives(
  shiftId: string,
  limit: number,
): Promise<Array<{ staffUserId: string; name: string; reason: string }>> {
  const shift = await prisma.shift.findUniqueOrThrow({
    where: { id: shiftId },
    include: { location: true },
  });

  const candidates = await prisma.user.findMany({
    where: {
      role: "STAFF",
      staffSkills: { some: { skillId: shift.requiredSkillId } },
      certifications: { some: { locationId: shift.locationId } },
    },
    take: 50,
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const out: Array<{ staffUserId: string; name: string; reason: string }> = [];
  for (const c of candidates) {
    const ctx = await buildConstraintContext(shiftId, c.id);
    const { hard } = evaluateAssignmentConstraints(ctx, {});
    if (hard.length === 0) {
      out.push({
        staffUserId: c.id,
        name: c.name,
        reason: "Has the required skill, site certification, availability for this time, and no scheduling conflicts.",
      });
      if (out.length >= limit) break;
    }
  }
  return out;
}

/** Other skill+location-qualified staff who are still blocked — helps managers compare options. */
async function findIneligibleCandidates(
  shiftId: string,
  excludeStaffId: string,
  eligibleIds: Set<string>,
  limit: number,
): Promise<Array<{ staffUserId: string; name: string; reason: string }>> {
  const shift = await prisma.shift.findUniqueOrThrow({
    where: { id: shiftId },
    include: { location: true },
  });

  const candidates = await prisma.user.findMany({
    where: {
      role: "STAFF",
      staffSkills: { some: { skillId: shift.requiredSkillId } },
      certifications: { some: { locationId: shift.locationId } },
    },
    take: 50,
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const out: Array<{ staffUserId: string; name: string; reason: string }> = [];
  for (const c of candidates) {
    if (c.id === excludeStaffId) continue;
    if (eligibleIds.has(c.id)) continue;
    const ctx = await buildConstraintContext(shiftId, c.id);
    const { hard } = evaluateAssignmentConstraints(ctx, {});
    if (hard.length === 0) continue;
    const primary = hard[0]!;
    const ruleLabel = CONSTRAINT_RULE_TITLES[primary.code] ?? primary.code;
    out.push({
      staffUserId: c.id,
      name: c.name,
      reason: `${ruleLabel}: ${primary.message}`,
    });
    if (out.length >= limit) break;
  }
  return out;
}
