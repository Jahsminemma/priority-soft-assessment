import { Prisma } from "@prisma/client";
import type { AssignmentCommitResponse, AssignmentPreviewResponse } from "@shiftsync/shared";
import { prisma } from "../lib/prisma.js";
import {
  evaluateAssignmentConstraints,
  type ConstraintContext,
  type ShiftIntervalInput,
} from "../domain/constraints.js";

export async function previewAssignment(
  shiftId: string,
  staffUserId: string,
): Promise<AssignmentPreviewResponse> {
  const constraintContext = await buildConstraintContext(shiftId, staffUserId);
  const { hard, warnings } = evaluateAssignmentConstraints(constraintContext, {});
  const ok = hard.length === 0;
  const alternatives = ok ? [] : await findAlternatives(shiftId, 5);
  return {
    ok,
    hardViolations: hard,
    warnings,
    alternatives,
  };
}

export async function commitAssignment(
  shiftId: string,
  staffUserId: string,
  idempotencyKey: string,
  seventhDayOverrideReason: string | undefined,
  actorUserId: string,
): Promise<AssignmentCommitResponse> {
  const existing = await prisma.idempotencyKey.findUnique({ where: { key: idempotencyKey } });
  if (existing) {
    return JSON.parse(JSON.stringify(existing.resultJson)) as AssignmentCommitResponse;
  }

  const constraintContext = await buildConstraintContext(shiftId, staffUserId);
  const { hard, warnings } = evaluateAssignmentConstraints(constraintContext, { seventhDayOverrideReason });

  if (hard.length > 0) {
    const res: AssignmentCommitResponse = {
      success: false,
      hardViolations: hard,
      warnings,
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
          actorUserId,
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

    return res;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
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

async function buildConstraintContext(
  shiftId: string,
  staffUserId: string,
): Promise<ConstraintContext> {
  const shift = await prisma.shift.findUniqueOrThrow({
    where: { id: shiftId },
    include: { location: true, requiredSkill: true },
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
        reason: "Has required skill, certification, availability, and no conflicts.",
      });
      if (out.length >= limit) break;
    }
  }
  return out;
}
