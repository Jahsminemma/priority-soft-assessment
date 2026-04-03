import { Prisma } from "@prisma/client";
import type { ConstraintViolation } from "@shiftsync/shared";
import type {
  AssignmentCommitResponse,
  AssignmentLaborImpact,
  AssignmentPreviewResponse,
  ModifyShiftOptions,
} from "@shiftsync/shared";
import { CONSTRAINT_RULE_TITLES, isoWeekKeyDbVariants, normalizeIsoWeekKey } from "@shiftsync/shared";
import {
  evaluateAssignmentConstraints,
  fifoStraightOtPerInterval,
  laborUsdFromSplit,
  resolveHourlyRateUsd,
  roundUsd,
  type FifoInterval,
  weekStartDateLocalFromWeekKey,
  type ConstraintContext,
  type ShiftIntervalInput,
} from "../../domain/scheduling/index.js";
import { prisma } from "../../infrastructure/persistence/index.js";
import { bumpScheduleContentRevision } from "../schedule/scheduleRevision.js";
import { emitAssignmentChanged, emitAssignmentConflict } from "../../realtime/events.js";
import { canModifyShift } from "../shifts/shift.service.js";
import { createNotification } from "../notifications/notification.service.js";
import type { AuthedUser } from "../../security/index.js";

const OT_WARNING_CODES = new Set(["WEEKLY_WARN_35", "WEEKLY_WARN_40"]);
const SWAP_PAIR_LIMIT = 40;

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
    include: {
      _count: { select: { assignments: true } },
      location: { select: { defaultHourlyRate: true } },
    },
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

  const laborImpact = await computeLaborImpactPreview(shiftSlot, staffUserId);

  const constraintContext = await buildConstraintContext(shiftId, staffUserId);
  const { hard, warnings } = evaluateAssignmentConstraints(constraintContext, {
    seventhDayOverrideReason: modifyOpts?.seventhDayOverrideReason,
  });
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
    laborImpact,
  };
}

async function computeLaborImpactPreview(
  shiftSlot: {
    id: string;
    startAtUtc: Date;
    endAtUtc: Date;
    weekKey: string;
    locationId: string;
    location: { defaultHourlyRate: number | null };
  },
  staffUserId: string,
): Promise<AssignmentLaborImpact> {
  const weekKeys = isoWeekKeyDbVariants(normalizeIsoWeekKey(shiftSlot.weekKey));
  const [staff, existingAssignments] = await Promise.all([
    prisma.user.findUnique({
      where: { id: staffUserId },
      select: { hourlyRate: true },
    }),
    prisma.shiftAssignment.findMany({
      where: {
        staffUserId,
        shift: { locationId: shiftSlot.locationId, weekKey: { in: weekKeys } },
      },
      include: { shift: true },
    }),
  ]);

  const rate = resolveHourlyRateUsd(staff?.hourlyRate ?? null, shiftSlot.location.defaultHourlyRate);

  const hypoDuration = (shiftSlot.endAtUtc.getTime() - shiftSlot.startAtUtc.getTime()) / 60_000;
  const hypoId = `__hypo__${shiftSlot.id}`;

  const existingIntervals: FifoInterval[] = existingAssignments.map((a) => ({
    id: a.id,
    startMs: a.shift.startAtUtc.getTime(),
    durationMin: (a.shift.endAtUtc.getTime() - a.shift.startAtUtc.getTime()) / 60_000,
  }));

  let baselineLabor = 0;
  if (existingIntervals.length > 0) {
    const baselineMap = fifoStraightOtPerInterval(existingIntervals);
    for (const a of existingAssignments) {
      const split = baselineMap.get(a.id)!;
      baselineLabor += laborUsdFromSplit(split.straightMin, split.otMin, rate);
    }
  }

  const projectedIntervals: FifoInterval[] = [
    ...existingIntervals,
    { id: hypoId, startMs: shiftSlot.startAtUtc.getTime(), durationMin: hypoDuration },
  ];
  const projectedMap = fifoStraightOtPerInterval(projectedIntervals);

  let projectedLabor = 0;
  for (const a of existingAssignments) {
    const split = projectedMap.get(a.id)!;
    projectedLabor += laborUsdFromSplit(split.straightMin, split.otMin, rate);
  }
  const hypoSplit = projectedMap.get(hypoId)!;
  projectedLabor += laborUsdFromSplit(hypoSplit.straightMin, hypoSplit.otMin, rate);

  const weeklyBaselineMinutes = existingIntervals.reduce((s, i) => s + i.durationMin, 0);

  return {
    hourlyRateUsd: roundUsd(rate),
    weeklyBaselineMinutes: Math.round(weeklyBaselineMinutes),
    weeklyAfterMinutes: Math.round(weeklyBaselineMinutes + hypoDuration),
    hypotheticalShiftStraightMinutes: Math.round(hypoSplit.straightMin),
    hypotheticalShiftOtMinutes: Math.round(hypoSplit.otMin),
    baselineLaborUsd: roundUsd(baselineLabor),
    projectedLaborUsd: roundUsd(projectedLabor),
    deltaLaborUsd: roundUsd(projectedLabor - baselineLabor),
  };
}

export async function removeAssignment(
  assignmentId: string,
  actor: AuthedUser,
  modifyOpts?: ModifyShiftOptions,
): Promise<{ ok: true } | { ok: false; reason: "NOT_FOUND" | "FORBIDDEN" | "PAST_CUTOFF" }> {
  const row = await prisma.shiftAssignment.findUnique({
    where: { id: assignmentId },
    include: { shift: { select: { id: true, locationId: true, weekKey: true } } },
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

  await bumpScheduleContentRevision(row.shift.locationId, row.shift.weekKey);

  return { ok: true };
}

function headcountFullViolation(headcount: number): ConstraintViolation {
  return {
    code: "HEADCOUNT_FULL",
    message: `This shift is already fully staffed (${headcount} of ${headcount} slots). Remove someone or raise headcount to add another person.`,
    severity: "hard",
  };
}

function commitDeniedForModifyGate(
  gate: Extract<Awaited<ReturnType<typeof canModifyShift>>, { ok: false }>,
): AssignmentCommitResponse {
  if (gate.code === "PAST_CUTOFF") {
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
          gate.code === "FORBIDDEN"
            ? "You can’t manage assignments for this location."
            : "Shift not found.",
        severity: "hard",
      },
    ],
    warnings: [],
  };
}

async function commitFailureWithAlternatives(
  shiftId: string,
  staffUserId: string,
  hard: ConstraintViolation[],
  warnings: ConstraintViolation[],
): Promise<AssignmentCommitResponse> {
  const alternatives = await findAlternatives(shiftId, 5);
  const eligibleIds = new Set(alternatives.map((a) => a.staffUserId));
  const ineligibleCandidates = await findIneligibleCandidates(shiftId, staffUserId, eligibleIds, 6);
  return { success: false, hardViolations: hard, warnings, alternatives, ineligibleCandidates };
}

type AssignmentInsertTxResult =
  | { kind: "ok"; created: { id: string }; warnings: ConstraintViolation[] }
  | { kind: "shift_gone" }
  | { kind: "headcount_full"; headcount: number }
  | { kind: "constraints"; hard: ConstraintViolation[]; warnings: ConstraintViolation[] };

async function executeSerializableAssignmentInsert(args: {
  shiftId: string;
  staffUserId: string;
  actor: AuthedUser;
  seventhDayOverrideReason: string | undefined;
}): Promise<AssignmentInsertTxResult> {
  const { shiftId, staffUserId, actor, seventhDayOverrideReason } = args;
  return prisma.$transaction(
    async (tx): Promise<AssignmentInsertTxResult> => {
      const slot = await tx.shift.findUnique({
        where: { id: shiftId },
        include: { _count: { select: { assignments: true } } },
      });
      if (!slot) return { kind: "shift_gone" };
      if (slot._count.assignments >= slot.headcount) {
        return { kind: "headcount_full", headcount: slot.headcount };
      }

      const ctx = await buildConstraintContext(shiftId, staffUserId, tx);
      const ev = evaluateAssignmentConstraints(ctx, { seventhDayOverrideReason });
      if (ev.hard.length > 0) {
        return { kind: "constraints", hard: ev.hard, warnings: ev.warnings };
      }

      await tx.user.findUniqueOrThrow({ where: { id: staffUserId } });

      const created = await tx.shiftAssignment.create({
        data: {
          shiftId,
          staffUserId,
          status: "ASSIGNED",
        },
      });

      const trimmedSeventh = seventhDayOverrideReason?.trim();
      await tx.auditLog.create({
        data: {
          actorUserId: actor.id,
          entityType: "ShiftAssignment",
          entityId: created.id,
          action: "CREATE",
          afterJson: {
            shiftId,
            staffUserId,
            ...(trimmedSeventh ? { seventhDayOverrideReason: trimmedSeventh } : {}),
          } as Prisma.InputJsonValue,
        },
      });

      return { kind: "ok", created, warnings: ev.warnings };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 5_000,
      timeout: 10_000,
    },
  );
}

async function finalizeAssignmentCommitSuccess(args: {
  shiftId: string;
  staffUserId: string;
  actor: AuthedUser;
  idempotencyKey: string;
  assignmentId: string;
  warnings: ConstraintViolation[];
}): Promise<AssignmentCommitResponse> {
  const { shiftId, staffUserId, actor, idempotencyKey, assignmentId, warnings } = args;

  const res: AssignmentCommitResponse = {
    success: true,
    assignmentId,
    hardViolations: [],
    warnings,
  };

  await prisma.idempotencyKey.create({
    data: { key: idempotencyKey, resultJson: res as Prisma.InputJsonValue },
  });

  const shiftRow = await prisma.shift.findUniqueOrThrow({
    where: { id: shiftId },
    select: {
      id: true,
      locationId: true,
      startAtUtc: true,
      endAtUtc: true,
      weekKey: true,
      location: { select: { tzIana: true, defaultHourlyRate: true } },
    },
  });
  emitAssignmentChanged(shiftRow.locationId, {
    shiftId,
    staffUserId,
    assignmentId,
  });
  await bumpScheduleContentRevision(shiftRow.locationId, shiftRow.weekKey);

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
      assignmentId,
      locationId: shiftRow.locationId,
      weekKey: shiftRow.weekKey,
      startAtUtc: shiftRow.startAtUtc.toISOString(),
      endAtUtc: shiftRow.endAtUtc.toISOString(),
    });
  }

  const otWarnings = warnings.filter((w) => OT_WARNING_CODES.has(w.code));
  if (otWarnings.length > 0) {
    const [laborImpact, staffMini, managerRows] = await Promise.all([
      computeLaborImpactPreview(
        {
          id: shiftRow.id,
          startAtUtc: shiftRow.startAtUtc,
          endAtUtc: shiftRow.endAtUtc,
          weekKey: shiftRow.weekKey,
          locationId: shiftRow.locationId,
          location: { defaultHourlyRate: shiftRow.location.defaultHourlyRate },
        },
        staffUserId,
      ),
      prisma.user.findUnique({ where: { id: staffUserId }, select: { name: true } }),
      prisma.managerLocation.findMany({
        where: { locationId: shiftRow.locationId },
        select: { userId: true },
      }),
    ]);
    const managerIds = [...new Set(managerRows.map((m) => m.userId))];
    const staffLabel =
      staffMini?.name != null && staffMini.name.trim() !== "" ? staffMini.name.trim() : staffUserId;
    for (const mid of managerIds) {
      await createNotification(mid, "assignment.overtime_risk", {
        shiftId,
        assignmentId,
        staffUserId,
        staffName: staffLabel,
        locationId: shiftRow.locationId,
        weekKey: shiftRow.weekKey,
        warnings: otWarnings.map((w) => ({ code: w.code, message: w.message })),
        laborImpact,
      });
    }
  }

  return res;
}

async function commitAssignmentConflictResponse(
  code: "P2002" | "P2034",
  shiftId: string,
  actor: AuthedUser,
): Promise<AssignmentCommitResponse> {
  const message =
    code === "P2002"
      ? "Assignment conflict — staff may already be assigned to this shift."
      : "Schedule changed while saving — refresh and try again.";
  const loc = await prisma.shift.findUnique({ where: { id: shiftId }, select: { locationId: true } });
  if (loc) {
    emitAssignmentConflict(loc.locationId, {
      shiftId,
      message,
      rejectedUserId: actor.id,
    });
  }
  return {
    success: false,
    hardViolations: [],
    warnings: [],
    conflict: true,
    message,
  };
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
    return commitDeniedForModifyGate(modifyGate);
  }

  if (shiftSlot._count.assignments >= shiftSlot.headcount) {
    return {
      success: false,
      hardViolations: [headcountFullViolation(shiftSlot.headcount)],
      warnings: [],
    };
  }

  const constraintContext = await buildConstraintContext(shiftId, staffUserId);
  const { hard, warnings } = evaluateAssignmentConstraints(constraintContext, { seventhDayOverrideReason });

  if (hard.length > 0) {
    return commitFailureWithAlternatives(shiftId, staffUserId, hard, warnings);
  }

  try {
    const txResult = await executeSerializableAssignmentInsert({
      shiftId,
      staffUserId,
      actor,
      seventhDayOverrideReason,
    });

    if (txResult.kind === "shift_gone") {
      return {
        success: false,
        hardViolations: [],
        warnings: [],
        conflict: true,
        message: "This shift no longer exists. Refresh the schedule and try again.",
      };
    }

    if (txResult.kind === "headcount_full") {
      return {
        success: false,
        hardViolations: [headcountFullViolation(txResult.headcount)],
        warnings: [],
      };
    }

    if (txResult.kind === "constraints") {
      return commitFailureWithAlternatives(shiftId, staffUserId, txResult.hard, txResult.warnings);
    }

    return finalizeAssignmentCommitSuccess({
      shiftId,
      staffUserId,
      actor,
      idempotencyKey,
      assignmentId: txResult.created.id,
      warnings: txResult.warnings,
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return commitAssignmentConflictResponse("P2002", shiftId, actor);
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") {
      return commitAssignmentConflictResponse("P2034", shiftId, actor);
    }
    throw e;
  }
}

export async function buildConstraintContext(
  shiftId: string,
  staffUserId: string,
  tx?: Prisma.TransactionClient,
): Promise<ConstraintContext> {
  const db = tx ?? prisma;

  const shift = await db.shift.findUniqueOrThrow({
    where: { id: shiftId },
    include: { location: true, requiredSkill: true },
  });

  const staffUser = await db.user.findUnique({
    where: { id: staffUserId },
    select: { name: true },
  });

  const staffSkills = await db.staffSkill.findMany({
    where: { userId: staffUserId },
    select: { skillId: true },
  });

  const certs = await db.staffCertification.findMany({
    where: { userId: staffUserId },
    select: { locationId: true },
  });

  const rules = await db.availabilityRule.findMany({
    where: { userId: staffUserId },
  });

  const exceptions = await db.availabilityException.findMany({
    where: { userId: staffUserId },
  });

  const assignments = await db.shiftAssignment.findMany({
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

export type SwapPairCandidate = {
  staffUserId: string;
  staffName: string;
  secondShiftId: string;
  theirShiftSkillName: string;
  theirShiftStartAtUtc: string;
  theirShiftEndAtUtc: string;
  theirShiftLocationName: string;
  theirShiftLocationTzIana: string;
};

/**
 * True two-way swap options: another staff member who holds a published shift in the same schedule
 * week (any site you both may work per constraints), where (1) they could take your shift and (2)
 * you could take theirs, with no hard constraint violations either way (skills, site cert,
 * availability, rest, overlaps, unavailable/leave exceptions). Coworkers on the same shift are excluded.
 */
export async function listSwapCandidatesForAssignedStaff(
  actor: AuthedUser,
  shiftId: string,
): Promise<
  | {
      ok: true;
      candidates: SwapPairCandidate[];
      hasPendingSwapRequest: boolean;
      pendingSwapRequestId: string | null;
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

  // Avoid presenting swap candidates whose "their shift" is already held by the requester.
  // This can happen when two staff share a shift or when the requester already picked up
  // that shift previously; in either case it is not a meaningful swap target.
  const requesterAssignedShiftIds = new Set(
    (
      await prisma.shiftAssignment.findMany({
        where: {
          staffUserId: actor.id,
          status: "ASSIGNED",
          shift: { weekKey: { in: weekKeys } },
        },
        select: { shiftId: true },
      })
    ).map((r) => r.shiftId),
  );

  const peerAssignments = await prisma.shiftAssignment.findMany({
    where: {
      staffUserId: { not: actor.id },
      status: "ASSIGNED",
      shift: {
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
    if (requesterAssignedShiftIds.has(theirShift.id)) continue;
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
      theirShiftLocationName: theirShift.location.name,
      theirShiftLocationTzIana: theirShift.location.tzIana,
    });
  }

  out.sort((a, b) => {
    const t = a.theirShiftStartAtUtc.localeCompare(b.theirShiftStartAtUtc);
    return t !== 0 ? t : a.staffName.localeCompare(b.staffName);
  });

  return {
    ok: true,
    candidates: out.slice(0, SWAP_PAIR_LIMIT),
    hasPendingSwapRequest,
    pendingSwapRequestId: pendingSwap?.id ?? null,
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
