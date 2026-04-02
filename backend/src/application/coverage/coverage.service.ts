import { Prisma } from "@prisma/client";
import type { CoverageRequestType } from "@prisma/client";
import type {
  CreateCoverageRequest,
  ManagerCoverageQueueItem,
  OpenCalloutItem,
  UserRole,
} from "@shiftsync/shared";
import { DateTime } from "luxon";
import { evaluateAssignmentConstraints } from "../../domain/scheduling/index.js";
import { prisma } from "../../infrastructure/persistence/index.js";
import { emitAssignmentChanged, emitCoverageUpdated } from "../../realtime/events.js";
import { buildConstraintContext } from "../assignments/assignment.service.js";
import { createNotification } from "../notifications/notification.service.js";
import { bumpScheduleContentRevisionsForShifts } from "../schedule/scheduleRevision.js";

const MAX_PENDING = 3;

/** If shift starts within this window, DROP is OPEN (broadcast + first claim final). */
const OPEN_CALLOUT_THRESHOLD_MS = 60 * 60 * 1000;

function computeDropExpiresAt(shiftStartUtc: Date): Date {
  const start = shiftStartUtc.getTime();
  const twentyFourHoursBefore = start - 24 * 60 * 60 * 1000;
  const oneMinuteBefore = start - 60 * 1000;
  const now = Date.now();
  if (twentyFourHoursBefore > now) return new Date(twentyFourHoursBefore);
  return new Date(Math.min(Math.max(oneMinuteBefore, now + 30 * 1000), start));
}

async function listEligibleStaffIdsForShift(shiftId: string, excludeUserId?: string): Promise<string[]> {
  const shift = await prisma.shift.findUniqueOrThrow({
    where: { id: shiftId },
    select: { locationId: true, requiredSkillId: true },
  });
  const rows = await prisma.user.findMany({
    where: {
      role: "STAFF",
      staffSkills: { some: { skillId: shift.requiredSkillId } },
      certifications: { some: { locationId: shift.locationId } },
      /** Already on this shift (e.g. multi-headcount) — cannot take the vacated slot again. */
      shiftAssignments: { none: { shiftId } },
      ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** Same hard rules as finalizeDropWithTarget (rest, overlaps, availability, etc.). */
async function filterStaffIdsPassingDropConstraints(shiftId: string, candidateIds: string[]): Promise<string[]> {
  if (candidateIds.length === 0) return [];
  const kept = await Promise.all(
    candidateIds.map(async (id) => {
      const ctx = await buildConstraintContext(shiftId, id);
      const { hard } = evaluateAssignmentConstraints(ctx, {});
      return hard.length === 0 ? id : null;
    }),
  );
  return kept.filter((id): id is string => id !== null);
}

type ShiftForAssignedNotice = {
  id: string;
  location: { name: string; tzIana: string };
  requiredSkill: { name: string };
  startAtUtc: Date;
  endAtUtc: Date;
};

function shiftAssignedNotificationPayload(
  requestId: string,
  shift: ShiftForAssignedNotice,
  extras?: Record<string, unknown>,
): Record<string, unknown> {
  const s = DateTime.fromJSDate(shift.startAtUtc, { zone: "utc" }).setZone(shift.location.tzIana);
  const e = DateTime.fromJSDate(shift.endAtUtc, { zone: "utc" }).setZone(shift.location.tzIana);
  return {
    requestId,
    shiftId: shift.id,
    locationName: shift.location.name,
    skillName: shift.requiredSkill.name,
    localDateLabel: s.toFormat("EEE, MMM d"),
    localTimeLabel: `${s.toFormat("h:mm a")}–${e.toFormat("h:mm a")}`,
    ...extras,
  };
}

async function isStaffEligibleForShift(staffUserId: string, shiftId: string): Promise<boolean> {
  const shift = await prisma.shift.findUniqueOrThrow({
    where: { id: shiftId },
    select: { locationId: true, requiredSkillId: true },
  });
  const row = await prisma.user.findFirst({
    where: {
      id: staffUserId,
      role: "STAFF",
      staffSkills: { some: { skillId: shift.requiredSkillId } },
      certifications: { some: { locationId: shift.locationId } },
    },
    select: { id: true },
  });
  return Boolean(row);
}

/** Notification payload when pending coverage is voided because a shift was edited. */
export type CoverageCancelledShiftEditPayload = {
  shiftId: string;
  secondShiftId?: string;
  reason: "shift_edited";
  actorUserId: string; // User that edited the shift (manager/admin)
};

type CoverageRealtimePayload = {
  requestId: string;
  status: string;
  type: CoverageRequestType;
};

function coverageCancelledShiftEditPayload(
  shiftId: string,
  secondShiftId: string | null,
  actorUserId: string,
): CoverageCancelledShiftEditPayload {
  if (secondShiftId != null) {
    return {
      shiftId,
      secondShiftId,
      reason: "shift_edited",
      actorUserId,
    };
  }
  return {
    shiftId,
    reason: "shift_edited",
    actorUserId,
  };
}

export async function expireStaleCoverageRequests(): Promise<void> {
  await prisma.coverageRequest.updateMany({
    where: { type: "DROP", status: "PENDING", expiresAt: { lt: new Date() } },
    data: { status: "EXPIRED" },
  });
}

const cancelCoverageForShiftSelect = {
  id: true,
  type: true,
  shiftId: true,
  secondShiftId: true,
  requesterId: true,
  targetId: true,
} as const;

/** Rows loaded for cancel-on-shift-edit includes `secondShiftId` for two-way swaps. */
type PendingCoverageToCancel = {
  id: string;
  type: CoverageRequestType;
  shiftId: string;
  secondShiftId: string | null;
  requesterId: string;
  targetId: string | null;
};

/** Cancels PENDING/ACCEPTED coverage when `shiftId` is edited, including two-way swaps where this shift is primary or secondary. */
export async function cancelCoverageForShift(shiftId: string, actorUserId: string): Promise<void> {
  const pendingWhere = {
    status: { in: ["PENDING", "ACCEPTED"] as const },
    OR: [{ shiftId }, { secondShiftId: shiftId }],
  } as Prisma.CoverageRequestWhereInput;

  const pending = (await prisma.coverageRequest.findMany({
    where: pendingWhere,
    select: cancelCoverageForShiftSelect,
  })) as PendingCoverageToCancel[];
  if (pending.length === 0) return;

  await prisma.coverageRequest.updateMany({
    where: pendingWhere,
    data: { status: "CANCELLED" },
  });

  const shiftIds = new Set<string>();

  for (const row of pending) {
    shiftIds.add(row.shiftId);
    if (row.secondShiftId != null) shiftIds.add(row.secondShiftId);
  }

  const shiftRows = await prisma.shift.findMany({
    where: { id: { in: [...shiftIds] } },
    select: { id: true, locationId: true },
  });
  const locationIdByShiftId = new Map<string, string>(shiftRows.map((s) => [s.id, s.locationId]));

  for (const row of pending) {
    const payload = coverageCancelledShiftEditPayload(row.shiftId, row.secondShiftId, actorUserId);
    const payloadRecord: Record<string, unknown> = { ...payload };
    await createNotification(row.requesterId, "coverage.cancelled", payloadRecord);
    if (row.targetId != null) {
      await createNotification(row.targetId, "coverage.cancelled", payloadRecord);
    }

    const wsPayload: CoverageRealtimePayload = {
      requestId: row.id,
      status: "CANCELLED",
      type: row.type,
    };

    const primaryLocationId = locationIdByShiftId.get(row.shiftId);
    const secondaryLocationId =
      row.secondShiftId != null ? locationIdByShiftId.get(row.secondShiftId) : undefined;

    const emittedLocations = new Set<string>();
    if (primaryLocationId !== undefined) {
      emittedLocations.add(primaryLocationId);
      emitCoverageUpdated(primaryLocationId, wsPayload);
    }
    if (secondaryLocationId !== undefined && !emittedLocations.has(secondaryLocationId)) {
      emitCoverageUpdated(secondaryLocationId, wsPayload);
    }
  }
}

/** Counts in-flight requests (waiting on peer or manager), not yet approved or terminal. */
async function countActiveForRequester(userId: string): Promise<number> {
  return prisma.coverageRequest.count({
    where: { requesterId: userId, status: { in: ["PENDING", "ACCEPTED"] } },
  });
}

async function distinctManagerUserIdsForLocations(locationIds: string[]): Promise<string[]> {
  const unique = [...new Set(locationIds.filter(Boolean))];
  if (unique.length === 0) return [];
  const rows = await prisma.managerLocation.findMany({
    where: { locationId: { in: unique } },
    select: { userId: true },
  });
  return [...new Set(rows.map((r) => r.userId))];
}

export async function createCoverageRequest(
  requesterId: string,
  input: CreateCoverageRequest,
): Promise<{ id: string }> {
  await expireStaleCoverageRequests();
  if ((await countActiveForRequester(requesterId)) >= MAX_PENDING) {
    throw new Error("MAX_PENDING_COVERAGE");
  }
  const shift = await prisma.shift.findUniqueOrThrow({
    where: { id: input.shiftId },
    include: { location: true, requiredSkill: true },
  });
  const assignment = await prisma.shiftAssignment.findFirst({
    where: { shiftId: shift.id, staffUserId: requesterId },
  });
  if (!assignment) throw new Error("NOT_ASSIGNED_TO_SHIFT");

  const existingOnThisShift = await prisma.coverageRequest.findFirst({
    where: {
      requesterId,
      shiftId: shift.id,
      status: { in: ["PENDING", "ACCEPTED"] },
    },
    select: { id: true },
  });
  if (existingOnThisShift) throw new Error("COVERAGE_ALREADY_PENDING_FOR_SHIFT");

  if (input.type === "SWAP") {
    if (input.targetId === requesterId) throw new Error("INVALID_TARGET");

    let secondShiftId: string | null = null;
    let peerShiftLocationId: string | null = null;
    let targetShift:
      | (typeof shift & { requiredSkill: { name: string } })
      | null = null;
    if (input.secondShiftId) {
      targetShift = await prisma.shift.findUniqueOrThrow({
        where: { id: input.secondShiftId },
        include: { location: true, requiredSkill: true },
      });
      const targetAssignment = await prisma.shiftAssignment.findFirst({
        where: { shiftId: targetShift.id, staffUserId: input.targetId, status: "ASSIGNED" },
      });
      if (!targetAssignment) throw new Error("TARGET_NOT_ON_SECOND_SHIFT");
      secondShiftId = targetShift.id;
      peerShiftLocationId = targetShift.locationId;
    }

    const req = await prisma.coverageRequest.create({
      data: {
        type: "SWAP",
        shiftId: shift.id,
        secondShiftId,
        requesterId,
        targetId: input.targetId,
        status: "PENDING",
      },
    });
    const requesterUser = await prisma.user.findUnique({
      where: { id: requesterId },
      select: { name: true },
    });

    const requesterShiftLocalStart = DateTime.fromJSDate(shift.startAtUtc, { zone: "utc" }).setZone(
      shift.location.tzIana,
    );
    const requesterShiftLocalEnd = DateTime.fromJSDate(shift.endAtUtc, { zone: "utc" }).setZone(shift.location.tzIana);

    const theirShiftPayload = {
      shiftId: shift.id,
      locationName: shift.location.name,
      locationTzIana: shift.location.tzIana,
      skillName: shift.requiredSkill.name,
      startAtUtc: shift.startAtUtc.toISOString(),
      endAtUtc: shift.endAtUtc.toISOString(),
      localDateLabel: requesterShiftLocalStart.toFormat("EEE, MMM d"),
      localTimeLabel: `${requesterShiftLocalStart.toFormat("h:mm a")}–${requesterShiftLocalEnd.toFormat("h:mm a")}`,
    };

    const myShiftPayload =
      targetShift != null
        ? (() => {
            const s = DateTime.fromJSDate(targetShift.startAtUtc, { zone: "utc" }).setZone(targetShift.location.tzIana);
            const e = DateTime.fromJSDate(targetShift.endAtUtc, { zone: "utc" }).setZone(targetShift.location.tzIana);
            return {
              shiftId: targetShift.id,
              locationName: targetShift.location.name,
              locationTzIana: targetShift.location.tzIana,
              skillName: targetShift.requiredSkill.name,
              startAtUtc: targetShift.startAtUtc.toISOString(),
              endAtUtc: targetShift.endAtUtc.toISOString(),
              localDateLabel: s.toFormat("EEE, MMM d"),
              localTimeLabel: `${s.toFormat("h:mm a")}–${e.toFormat("h:mm a")}`,
            };
          })()
        : null;

    await createNotification(input.targetId, "coverage.swap_requested", {
      requestId: req.id,
      shiftId: shift.id,
      secondShiftId: secondShiftId ?? undefined,
      requesterId,
      twoWay: Boolean(secondShiftId),
      requesterName: requesterUser?.name ?? "Coworker",
      theirShift: theirShiftPayload,
      myShift: myShiftPayload ?? undefined,
    });
    const managerLocationIds =
      secondShiftId != null && peerShiftLocationId != null
        ? [...new Set([shift.locationId, peerShiftLocationId])]
        : [shift.locationId];
    const managerUserIds = await distinctManagerUserIdsForLocations(managerLocationIds);
    for (const uid of managerUserIds) {
      await createNotification(uid, "coverage.manager_pending", {
        requestId: req.id,
        shiftId: shift.id,
        secondShiftId,
        type: "SWAP",
        twoWay: Boolean(secondShiftId),
      });
    }
    emitCoverageUpdated(shift.locationId, { requestId: req.id, status: "PENDING", type: "SWAP" });
    if (peerShiftLocationId != null && peerShiftLocationId !== shift.locationId) {
      emitCoverageUpdated(peerShiftLocationId, { requestId: req.id, status: "PENDING", type: "SWAP" });
    }
    return { id: req.id };
  }

  const msUntilShift = shift.startAtUtc.getTime() - Date.now();
  const calloutMode: "OPEN" | "DIRECTED" =
    msUntilShift <= OPEN_CALLOUT_THRESHOLD_MS && msUntilShift > 0 ? "OPEN" : "DIRECTED";
  const expiresAt = computeDropExpiresAt(shift.startAtUtc);

  const req = await prisma.coverageRequest.create({
    data: {
      type: "DROP",
      shiftId: shift.id,
      requesterId,
      targetId: null,
      status: "PENDING",
      expiresAt,
      calloutMode,
    },
  });

  const requesterUser = await prisma.user.findUnique({
    where: { id: requesterId },
    select: { name: true },
  });

  const theirShiftPayload = {
    shiftId: shift.id,
    locationName: shift.location.name,
    locationTzIana: shift.location.tzIana,
    skillName: shift.requiredSkill.name,
    startAtUtc: shift.startAtUtc.toISOString(),
    endAtUtc: shift.endAtUtc.toISOString(),
    localDateLabel: DateTime.fromJSDate(shift.startAtUtc, { zone: "utc" })
      .setZone(shift.location.tzIana)
      .toFormat("EEE, MMM d"),
    localTimeLabel: `${DateTime.fromJSDate(shift.startAtUtc, { zone: "utc" }).setZone(shift.location.tzIana).toFormat("h:mm a")}–${DateTime.fromJSDate(shift.endAtUtc, { zone: "utc" }).setZone(shift.location.tzIana).toFormat("h:mm a")}`,
  };

  const managers = await prisma.managerLocation.findMany({
    where: { locationId: shift.locationId },
    select: { userId: true },
  });
  for (const m of managers) {
    await createNotification(m.userId, "coverage.manager_pending", {
      requestId: req.id,
      shiftId: shift.id,
      type: "DROP",
      calloutMode,
    });
  }

  if (calloutMode === "OPEN") {
    const eligibleIds = await listEligibleStaffIdsForShift(shift.id, requesterId);
    for (const uid of eligibleIds) {
      await createNotification(uid, "coverage.callout_open", {
        requestId: req.id,
        shiftId: shift.id,
        requesterId,
        requesterName: requesterUser?.name ?? "Coworker",
        calloutMode: "OPEN",
        theirShift: theirShiftPayload,
      });
    }
  }

  emitCoverageUpdated(shift.locationId, { requestId: req.id, status: "PENDING", type: "DROP" });
  return { id: req.id };
}

export type FinalizeDropFailure = { ok: false; code: string; messages?: string[] };

/**
 * Final DROP: move assignment from requester to target in one transaction (no separate manager approval).
 * OPEN: staff may only claim for themselves; managers may assign any eligible staff.
 * DIRECTED: only managers/admins may assign.
 */
export async function finalizeDropWithTarget(
  requestId: string,
  targetUserId: string,
  actor: { id: string; role: UserRole },
): Promise<{ ok: true } | FinalizeDropFailure> {
  await expireStaleCoverageRequests();
  const req = await prisma.coverageRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: {
      shift: { include: { location: true, requiredSkill: true } },
    },
  });
  if (req.type !== "DROP") return { ok: false, code: "INVALID" };
  if (req.status !== "PENDING") return { ok: false, code: "NOT_PENDING" };
  if (req.targetId !== null) return { ok: false, code: "CONFLICT" };

  const mode = req.calloutMode ?? "DIRECTED";

  if (mode === "DIRECTED") {
    if (actor.role !== "ADMIN" && actor.role !== "MANAGER") {
      return { ok: false, code: "FORBIDDEN" };
    }
    if (!(await managerMayApproveCoverage(actor.id, req.shift.locationId, null))) {
      return { ok: false, code: "FORBIDDEN" };
    }
  } else {
    if (actor.role === "STAFF") {
      if (actor.id !== targetUserId) return { ok: false, code: "FORBIDDEN" };
      if (actor.id === req.requesterId) return { ok: false, code: "SELF" };
    } else if (actor.role === "ADMIN" || actor.role === "MANAGER") {
      if (!(await managerMayApproveCoverage(actor.id, req.shift.locationId, null))) {
        return { ok: false, code: "FORBIDDEN" };
      }
    } else {
      return { ok: false, code: "FORBIDDEN" };
    }
  }

  if (!(await isStaffEligibleForShift(targetUserId, req.shiftId))) {
    return { ok: false, code: "NOT_ELIGIBLE" };
  }

  const ctx = await buildConstraintContext(req.shiftId, targetUserId);
  const { hard } = evaluateAssignmentConstraints(ctx, {});
  if (hard.length > 0) {
    return { ok: false, code: "CONSTRAINTS", messages: hard.map((h) => h.message) };
  }

  let newAssignmentId = "";
  try {
    newAssignmentId = await prisma.$transaction(async (tx) => {
      const cur = await tx.coverageRequest.findUnique({
        where: { id: requestId },
        select: { id: true, status: true, type: true, shiftId: true, requesterId: true },
      });
      if (!cur || cur.status !== "PENDING" || cur.type !== "DROP") throw new Error("CONFLICT");

      const del = await tx.shiftAssignment.deleteMany({
        where: { shiftId: cur.shiftId, staffUserId: cur.requesterId },
      });
      if (del.count !== 1) throw new Error("NO_ASSIGNMENT");

      /** Target may already be on this shift (headcount > 1). Removing the requester must not add a duplicate row. */
      const existingForTarget = await tx.shiftAssignment.findFirst({
        where: { shiftId: cur.shiftId, staffUserId: targetUserId, status: "ASSIGNED" },
      });
      let assignmentId: string;
      if (existingForTarget) {
        assignmentId = existingForTarget.id;
      } else {
        const created = await tx.shiftAssignment.create({
          data: { shiftId: cur.shiftId, staffUserId: targetUserId, status: "ASSIGNED" },
        });
        assignmentId = created.id;
      }

      await tx.coverageRequest.update({
        where: { id: requestId },
        data: { targetId: targetUserId, status: "MANAGER_APPROVED" },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: actor.id,
          entityType: "CoverageRequest",
          entityId: requestId,
          action: mode === "OPEN" && actor.role === "STAFF" ? "CLAIM_DROP" : "MANAGER_ASSIGN_DROP",
          afterJson: {
            shiftId: req.shiftId,
            requesterId: req.requesterId,
            targetId: targetUserId,
          } as Prisma.InputJsonValue,
        },
      });
      return assignmentId;
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "CONFLICT") return { ok: false, code: "CONFLICT" };
    if (msg === "NO_ASSIGNMENT") return { ok: false, code: "NO_ASSIGNMENT" };
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return {
        ok: false,
        code: "CONFLICT",
        messages: ["That person is already assigned to this shift."],
      };
    }
    throw e;
  }

  emitAssignmentChanged(req.shift.locationId, {
    shiftId: req.shiftId,
    staffUserId: targetUserId,
    assignmentId: newAssignmentId,
  });

  await createNotification(req.requesterId, "coverage.drop_resolved", { requestId, shiftId: req.shiftId });
  await createNotification(
    targetUserId,
    "coverage.shift_assigned",
    shiftAssignedNotificationPayload(requestId, req.shift, { fromDrop: true }),
  );

  emitCoverageUpdated(req.shift.locationId, { requestId, status: "MANAGER_APPROVED", type: "DROP" });
  await bumpScheduleContentRevisionsForShifts([{ locationId: req.shift.locationId, weekKey: req.shift.weekKey }]);

  return { ok: true };
}

export async function acceptCoverageRequest(
  requestId: string,
  actorId: string,
): Promise<{ ok: true } | FinalizeDropFailure | { ok: false; code: string }> {
  await expireStaleCoverageRequests();
  const req = await prisma.coverageRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: {
      shift: { include: { location: true } },
      secondShift: { select: { locationId: true } },
    },
  });
  if (req.status !== "PENDING") return { ok: false, code: "NOT_PENDING" };
  if (req.requesterId === actorId) return { ok: false, code: "SELF" };

  if (req.type === "SWAP") {
    if (req.targetId !== actorId) return { ok: false, code: "NOT_TARGET" };
    await prisma.coverageRequest.update({
      where: { id: requestId },
      data: { status: "ACCEPTED" },
    });
    await createNotification(req.requesterId, "coverage.accepted", {
      requestId,
      shiftId: req.shiftId,
      secondShiftId: req.secondShiftId ?? undefined,
    });
    const swapManagerLocs =
      req.secondShiftId != null && req.secondShift != null
        ? [...new Set([req.shift.locationId, req.secondShift.locationId])]
        : [req.shift.locationId];
    const managerUserIds = await distinctManagerUserIdsForLocations(swapManagerLocs);
    for (const uid of managerUserIds) {
      await createNotification(uid, "coverage.ready_for_approval", {
        requestId,
        shiftId: req.shiftId,
        secondShiftId: req.secondShiftId ?? undefined,
      });
    }
    emitCoverageUpdated(req.shift.locationId, { requestId, status: "ACCEPTED", type: "SWAP" });
    if (
      req.secondShift != null &&
      req.secondShift.locationId !== req.shift.locationId
    ) {
      emitCoverageUpdated(req.secondShift.locationId, { requestId, status: "ACCEPTED", type: "SWAP" });
    }
    return { ok: true };
  }

  if (req.type === "DROP" && req.targetId === null) {
    const mode = req.calloutMode ?? "DIRECTED";
    if (mode === "DIRECTED") {
      return { ok: false, code: "DIRECTED_USE_ASSIGN" };
    }
    return finalizeDropWithTarget(requestId, actorId, { id: actorId, role: "STAFF" });
  }

  return { ok: false, code: "INVALID" };
}

export async function managerMayApproveCoverage(
  managerId: string,
  locationId: string,
  secondLocationId: string | null,
): Promise<boolean> {
  const manager = await prisma.user.findUnique({ where: { id: managerId } });
  if (!manager) return false;
  if (manager.role === "ADMIN") return true;
  const a = await prisma.managerLocation.findFirst({
    where: { userId: managerId, locationId },
  });
  if (!a) return false;
  if (!secondLocationId || secondLocationId === locationId) return true;
  const b = await prisma.managerLocation.findFirst({
    where: { userId: managerId, locationId: secondLocationId },
  });
  return Boolean(b);
}

export async function approveCoverageRequest(
  requestId: string,
  managerId: string,
): Promise<{ ok: true } | FinalizeDropFailure | { ok: false; code: string }> {
  await expireStaleCoverageRequests();
  const req = await prisma.coverageRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: {
      shift: { include: { location: true, requiredSkill: true } },
      secondShift: { include: { location: true, requiredSkill: true } },
    },
  });
  if (req.status !== "ACCEPTED") return { ok: false, code: "NOT_ACCEPTED" };
  const targetId = req.targetId;
  if (!targetId) return { ok: false, code: "NO_TARGET" };

  const secondLocId = req.secondShiftId ? req.secondShift?.locationId ?? null : null;
  const may = await managerMayApproveCoverage(managerId, req.shift.locationId, secondLocId);
  if (!may) return { ok: false, code: "FORBIDDEN" };

  if (req.type === "SWAP" && req.secondShiftId) {
    const secondShiftId = req.secondShiftId;
    const targetOnSecond = await prisma.shiftAssignment.findFirst({
      where: { shiftId: secondShiftId, staffUserId: targetId, status: "ASSIGNED" },
    });
    if (!targetOnSecond) return { ok: false, code: "NO_TARGET_ASSIGNMENT" };

    let assignmentIdPrimary = "";
    let assignmentIdSecond = "";
    try {
      await prisma.$transaction(async (tx) => {
        const delA = await tx.shiftAssignment.deleteMany({
          where: { shiftId: req.shiftId, staffUserId: req.requesterId },
        });
        const delB = await tx.shiftAssignment.deleteMany({
          where: { shiftId: secondShiftId, staffUserId: targetId },
        });
        if (delA.count !== 1 || delB.count !== 1) throw new Error("NO_ASSIGNMENT");

        const hTargetOnPrimary = evaluateAssignmentConstraints(
          await buildConstraintContext(req.shiftId, targetId),
          {},
        );
        const hRequesterOnSecond = evaluateAssignmentConstraints(
          await buildConstraintContext(secondShiftId, req.requesterId),
          {},
        );
        if (hTargetOnPrimary.hard.length > 0 || hRequesterOnSecond.hard.length > 0) {
          throw new Error("CONSTRAINTS");
        }

        const createdPrimary = await tx.shiftAssignment.create({
          data: { shiftId: req.shiftId, staffUserId: targetId, status: "ASSIGNED" },
        });
        const createdSecond = await tx.shiftAssignment.create({
          data: { shiftId: secondShiftId, staffUserId: req.requesterId, status: "ASSIGNED" },
        });
        assignmentIdPrimary = createdPrimary.id;
        assignmentIdSecond = createdSecond.id;

        await tx.coverageRequest.update({
          where: { id: requestId },
          data: { status: "MANAGER_APPROVED" },
        });
        await tx.auditLog.create({
          data: {
            actorUserId: managerId,
            entityType: "CoverageRequest",
            entityId: requestId,
            action: "APPROVE_TWO_WAY_SWAP",
            afterJson: {
              shiftId: req.shiftId,
              secondShiftId,
              requesterId: req.requesterId,
              targetId,
              assignmentIds: [createdPrimary.id, createdSecond.id],
            } as Prisma.InputJsonValue,
          },
        });
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "CONSTRAINTS") return { ok: false, code: "CONSTRAINTS" };
      if (msg === "NO_ASSIGNMENT") return { ok: false, code: "NO_ASSIGNMENT" };
      throw e;
    }

    const primaryLocId = req.shift.locationId;
    const secondShiftLocId = req.secondShift?.locationId ?? primaryLocId;
    emitAssignmentChanged(primaryLocId, {
      shiftId: req.shiftId,
      staffUserId: targetId,
      assignmentId: assignmentIdPrimary,
    });
    emitAssignmentChanged(secondShiftLocId, {
      shiftId: secondShiftId,
      staffUserId: req.requesterId,
      assignmentId: assignmentIdSecond,
    });

    await createNotification(
      req.requesterId,
      "coverage.shift_assigned",
      shiftAssignedNotificationPayload(requestId, req.secondShift!, { swap: true }),
    );
    await createNotification(
      targetId,
      "coverage.shift_assigned",
      shiftAssignedNotificationPayload(requestId, req.shift, { swap: true }),
    );
    emitCoverageUpdated(primaryLocId, { requestId, status: "MANAGER_APPROVED", type: req.type });
    if (secondShiftLocId !== primaryLocId) {
      emitCoverageUpdated(secondShiftLocId, { requestId, status: "MANAGER_APPROVED", type: req.type });
    }
    if (req.secondShift) {
      await bumpScheduleContentRevisionsForShifts([
        { locationId: req.shift.locationId, weekKey: req.shift.weekKey },
        { locationId: req.secondShift.locationId, weekKey: req.secondShift.weekKey },
      ]);
    }
    return { ok: true };
  }

  if (req.type !== "SWAP" && req.type !== "DROP") {
    return { ok: false, code: "INVALID" };
  }

  const ctx = await buildConstraintContext(req.shiftId, targetId);
  const { hard } = evaluateAssignmentConstraints(ctx, {});
  if (hard.length > 0) {
    return { ok: false, code: "CONSTRAINTS", messages: hard.map((h) => h.message) };
  }

  let newAssignmentId: string;
  try {
    newAssignmentId = await prisma.$transaction(async (tx) => {
      const del = await tx.shiftAssignment.deleteMany({
        where: { shiftId: req.shiftId, staffUserId: req.requesterId },
      });
      if (del.count !== 1) throw new Error("NO_ASSIGNMENT");
      const created = await tx.shiftAssignment.create({
        data: { shiftId: req.shiftId, staffUserId: targetId, status: "ASSIGNED" },
      });
      await tx.coverageRequest.update({
        where: { id: requestId },
        data: { status: "MANAGER_APPROVED" },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: managerId,
          entityType: "CoverageRequest",
          entityId: requestId,
          action: "APPROVE",
          afterJson: { shiftId: req.shiftId, requesterId: req.requesterId, targetId } as Prisma.InputJsonValue,
        },
      });
      return created.id;
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "NO_ASSIGNMENT") return { ok: false, code: "NO_ASSIGNMENT" };
    throw e;
  }

  emitAssignmentChanged(req.shift.locationId, {
    shiftId: req.shiftId,
    staffUserId: targetId,
    assignmentId: newAssignmentId,
  });

  await createNotification(req.requesterId, "coverage.drop_resolved", { requestId, shiftId: req.shiftId });
  await createNotification(
    targetId,
    "coverage.shift_assigned",
    shiftAssignedNotificationPayload(requestId, req.shift, { fromDrop: true }),
  );
  emitCoverageUpdated(req.shift.locationId, { requestId, status: "MANAGER_APPROVED", type: req.type });
  await bumpScheduleContentRevisionsForShifts([{ locationId: req.shift.locationId, weekKey: req.shift.weekKey }]);
  return { ok: true };
}

export async function cancelCoverageRequest(requestId: string, actorId: string): Promise<{ ok: boolean }> {
  const req = await prisma.coverageRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: { shift: true, secondShift: { select: { locationId: true } } },
  });
  if (req.requesterId !== actorId) return { ok: false };
  if (req.status !== "PENDING" && req.status !== "ACCEPTED") return { ok: false };
  await prisma.coverageRequest.update({
    where: { id: requestId },
    data: { status: "CANCELLED" },
  });
  if (req.targetId) {
    await createNotification(req.targetId, "coverage.cancelled", {
      shiftId: req.shiftId,
      secondShiftId: req.secondShiftId ?? undefined,
      reason: "requester",
    });
  }
  emitCoverageUpdated(req.shift.locationId, { requestId, status: "CANCELLED", type: req.type });
  if (
    req.secondShift != null &&
    req.secondShift.locationId !== req.shift.locationId
  ) {
    emitCoverageUpdated(req.secondShift.locationId, { requestId, status: "CANCELLED", type: req.type });
  }
  return { ok: true };
}

export async function declineCoverageRequest(
  requestId: string,
  actorId: string,
): Promise<{ ok: true } | { ok: false; code: string }> {
  await expireStaleCoverageRequests();
  const req = await prisma.coverageRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: {
      shift: { select: { id: true, locationId: true } },
      secondShift: { select: { id: true, locationId: true } },
    },
  });

  if (req.type !== "SWAP") return { ok: false, code: "INVALID" };
  // Allow the target to reject while still pending OR after they've accepted (before manager approval),
  // since staff can change their mind and should be able to undo an acceptance.
  if (req.status !== "PENDING" && req.status !== "ACCEPTED") return { ok: false, code: "NOT_PENDING" };
  if (req.targetId !== actorId) return { ok: false, code: "NOT_TARGET" };
  if (req.requesterId === actorId) return { ok: false, code: "SELF" };

  await prisma.coverageRequest.update({
    where: { id: requestId },
    data: { status: "DECLINED" },
  });

  await createNotification(req.requesterId, "coverage.declined", {
    requestId,
    shiftId: req.shiftId,
    secondShiftId: req.secondShiftId ?? undefined,
    byUserId: actorId,
  });

  emitCoverageUpdated(req.shift.locationId, { requestId, status: "DECLINED", type: req.type });
  if (req.secondShift != null && req.secondShift.locationId !== req.shift.locationId) {
    emitCoverageUpdated(req.secondShift.locationId, { requestId, status: "DECLINED", type: req.type });
  }

  return { ok: true };
}

type ShiftForCoverageSummary = {
  id: string;
  locationId: string;
  location: { name: string; tzIana: string };
  requiredSkill: { name: string };
  startAtUtc: Date;
  endAtUtc: Date;
};

function coverageShiftSummary(shift: ShiftForCoverageSummary): ManagerCoverageQueueItem["primaryShift"] {
  const s = DateTime.fromJSDate(shift.startAtUtc, { zone: "utc" }).setZone(shift.location.tzIana);
  const e = DateTime.fromJSDate(shift.endAtUtc, { zone: "utc" }).setZone(shift.location.tzIana);
  return {
    shiftId: shift.id,
    locationId: shift.locationId,
    locationName: shift.location.name,
    skillName: shift.requiredSkill.name,
    localDateLabel: s.toFormat("EEE, MMM d"),
    localTimeLabel: `${s.toFormat("h:mm a")}–${e.toFormat("h:mm a")}`,
  };
}

export type ManagerCoverageQueueActor = {
  id: string;
  role: UserRole;
  managerLocationIds: string[];
};

/**
 * Open coverage work for managers: PENDING (swap/drop in flight) and ACCEPTED (awaiting manager approval).
 */
export async function listManagerCoverageQueue(actor: ManagerCoverageQueueActor): Promise<ManagerCoverageQueueItem[]> {
  await expireStaleCoverageRequests();

  if (actor.role === "MANAGER" && actor.managerLocationIds.length === 0) {
    return [];
  }

  const locationWhere =
    actor.role === "ADMIN"
      ? undefined
      : {
          OR: [
            { shift: { locationId: { in: actor.managerLocationIds } } },
            { secondShift: { locationId: { in: actor.managerLocationIds } } },
          ],
        };

  const rows = await prisma.coverageRequest.findMany({
    where: {
      status: { in: ["PENDING", "ACCEPTED"] },
      ...locationWhere,
    },
    include: {
      shift: { include: { location: true, requiredSkill: true } },
      secondShift: { include: { location: true, requiredSkill: true } },
      requester: { select: { id: true, name: true } },
      target: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const out: ManagerCoverageQueueItem[] = [];
  for (const req of rows) {
    const secondLocId = req.secondShiftId ? req.secondShift?.locationId ?? null : null;
    const canApprove =
      req.status === "ACCEPTED" &&
      (await managerMayApproveCoverage(actor.id, req.shift.locationId, secondLocId));

    let eligibleCandidates: ManagerCoverageQueueItem["eligibleCandidates"] = [];
    if (req.type === "DROP" && req.status === "PENDING") {
      const ids = await listEligibleStaffIdsForShift(req.shiftId, req.requesterId);
      const constraintOk = await filterStaffIdsPassingDropConstraints(req.shiftId, ids);
      const users = await prisma.user.findMany({
        where: { id: { in: constraintOk } },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
        take: 40,
      });
      eligibleCandidates = users.map((u) => ({ id: u.id, name: u.name }));
    }

    out.push({
      id: req.id,
      type: req.type,
      status: req.status as "PENDING" | "ACCEPTED",
      requesterId: req.requesterId,
      requesterName: req.requester.name,
      targetId: req.targetId,
      targetName: req.target?.name ?? null,
      twoWay: Boolean(req.secondShiftId),
      primaryShift: coverageShiftSummary(req.shift),
      secondShift: req.secondShift ? coverageShiftSummary(req.secondShift) : null,
      canApprove,
      expiresAt: req.expiresAt ? req.expiresAt.toISOString() : null,
      calloutMode: req.type === "DROP" ? req.calloutMode ?? null : null,
      eligibleCandidates,
    });
  }

  return out;
}

export async function listOpenCalloutsForStaff(staffUserId: string): Promise<OpenCalloutItem[]> {
  await expireStaleCoverageRequests();
  const rows = await prisma.coverageRequest.findMany({
    where: {
      type: "DROP",
      status: "PENDING",
      calloutMode: "OPEN",
      requesterId: { not: staffUserId },
    },
    include: {
      shift: { include: { location: true, requiredSkill: true } },
      requester: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const out: OpenCalloutItem[] = [];
  for (const r of rows) {
    if (await isStaffEligibleForShift(staffUserId, r.shiftId)) {
      out.push({
        requestId: r.id,
        requesterId: r.requesterId,
        requesterName: r.requester.name,
        shift: coverageShiftSummary(r.shift),
      });
    }
  }
  return out;
}
