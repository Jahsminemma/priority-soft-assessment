import { randomInt } from "node:crypto";
import { prisma } from "../../infrastructure/persistence/index.js";
import { emitPresenceOnDutyUpdated } from "../../realtime/events.js";

const CLOCK_IN_CODE_TTL_MS = 15 * 60 * 1000;

function randomSixDigitCode(): string {
  return String(randomInt(100_000, 1_000_000));
}

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

export type ClockSessionHistoryRow = {
  sessionId: string;
  shiftId: string | null;
  locationId: string | null;
  locationName: string | null;
  tzIana: string | null;
  clockInAtUtc: string;
  clockOutAtUtc: string | null;
};

export async function listMyClockSessions(staffUserId: string): Promise<ClockSessionHistoryRow[]> {
  const sessions = await prisma.clockSession.findMany({
    where: { staffUserId },
    include: {
      shift: { include: { location: { select: { id: true, name: true, tzIana: true } } } },
    },
    orderBy: { clockInAtUtc: "desc" },
    take: 200,
  });

  return sessions.map((s) => ({
    sessionId: s.id,
    shiftId: s.shift?.id ?? s.shiftId ?? null,
    locationId: s.shift?.location?.id ?? null,
    locationName: s.shift?.location?.name ?? null,
    tzIana: s.shift?.location?.tzIana ?? null,
    clockInAtUtc: s.clockInAtUtc.toISOString(),
    clockOutAtUtc: s.clockOutAtUtc?.toISOString() ?? null,
  }));
}

/** Normalize to exactly 6 digits, or null. */
export function normalizeClockCodeInput(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  return digits.length === 6 ? digits : null;
}

export type ClockCodePreviewResult = {
  staff: { id: string; name: string; email: string };
  shift: { id: string; startAtUtc: string; endAtUtc: string };
  location: { id: string; name: string; tzIana: string };
  skillName: string;
  expiresAtUtc: string;
  /** Non-null when the manager may want extra care (e.g. shift at a site they don’t manage). */
  managerLocationWarning: string | null;
  shiftLocationId: string;
};

function managerLocationWarning(args: {
  managerRole: "ADMIN" | "MANAGER";
  managerLocationIds: string[];
  shiftLocationId: string;
  shiftLocationName: string;
}): string | null {
  if (args.managerRole === "ADMIN") return null;
  if (args.managerLocationIds.includes(args.shiftLocationId)) return null;
  if (args.managerLocationIds.length === 0) {
    return `This shift is at ${args.shiftLocationName}, but you have no locations assigned on your profile. Approve only if your organization allows it.`;
  }
  return `This shift is at ${args.shiftLocationName}, which is not in your assigned locations. You can still approve remote verification or coverage — confirm this matches your policy.`;
}

async function loadCodeRowForLookup(code: string) {
  return prisma.clockInVerificationCode.findUnique({
    where: { code },
    include: {
      staff: { select: { id: true, name: true, email: true } },
      shift: {
        include: {
          location: { select: { id: true, name: true, tzIana: true } },
          requiredSkill: { select: { name: true } },
        },
      },
    },
  });
}

export async function previewClockInCode(
  rawCode: string,
  managerRole: "ADMIN" | "MANAGER",
  managerLocationIds: string[],
): Promise<ClockCodePreviewResult> {
  const code = normalizeClockCodeInput(rawCode);
  if (!code) throw new Error("INVALID_CODE");

  const row = await loadCodeRowForLookup(code);
  if (!row) throw new Error("CODE_NOT_FOUND");

  const now = new Date();
  if (row.consumedAt) throw new Error("CODE_ALREADY_USED");
  if (now > row.expiresAt) throw new Error("CODE_EXPIRED");

  const loc = row.shift.location;
  const warning = managerLocationWarning({
    managerRole,
    managerLocationIds,
    shiftLocationId: loc.id,
    shiftLocationName: loc.name,
  });

  return {
    staff: {
      id: row.staff.id,
      name: row.staff.name,
      email: row.staff.email,
    },
    shift: {
      id: row.shift.id,
      startAtUtc: row.shift.startAtUtc.toISOString(),
      endAtUtc: row.shift.endAtUtc.toISOString(),
    },
    location: {
      id: loc.id,
      name: loc.name,
      tzIana: loc.tzIana,
    },
    skillName: row.shift.requiredSkill.name,
    expiresAtUtc: row.expiresAt.toISOString(),
    managerLocationWarning: warning,
    shiftLocationId: loc.id,
  };
}

export async function approveClockInCode(rawCode: string, managerUserId: string): Promise<{ sessionId: string }> {
  const code = normalizeClockCodeInput(rawCode);
  if (!code) throw new Error("INVALID_CODE");

  return prisma.$transaction(async (tx) => {
    const row = await tx.clockInVerificationCode.findUnique({
      where: { code },
      include: {
        shift: { include: { location: true } },
      },
    });
    if (!row) throw new Error("CODE_NOT_FOUND");

    const now = new Date();
    if (row.consumedAt) throw new Error("CODE_ALREADY_USED");
    if (now > row.expiresAt) throw new Error("CODE_EXPIRED");

    const assignment = await tx.shiftAssignment.findFirst({
      where: { shiftId: row.shiftId, staffUserId: row.staffUserId, status: "ASSIGNED" },
      include: { shift: true },
    });
    if (!assignment) throw new Error("NOT_ASSIGNED_TO_SHIFT");

    const { shift } = assignment;
    if (now > shift.endAtUtc) throw new Error("SHIFT_ENDED");

    const open = await tx.clockSession.findFirst({
      where: { staffUserId: row.staffUserId, clockOutAtUtc: null },
    });
    if (open) throw new Error("ALREADY_CLOCKED_IN");

    const session = await tx.clockSession.create({
      data: {
        staffUserId: row.staffUserId,
        shiftId: row.shiftId,
        clockInAtUtc: now,
      },
    });

    await tx.clockInVerificationCode.update({
      where: { id: row.id },
      data: {
        consumedAt: now,
        verifiedByUserId: managerUserId,
      },
    });

    emitPresenceOnDutyUpdated(shift.locationId, { locationId: shift.locationId });
    return { sessionId: session.id };
  });
}

export async function requestClockInCode(
  staffUserId: string,
  shiftId: string,
): Promise<{ code: string; expiresAtUtc: string }> {
  const assignment = await prisma.shiftAssignment.findFirst({
    where: { shiftId, staffUserId, status: "ASSIGNED" },
    include: { shift: true },
  });
  if (!assignment) throw new Error("NOT_ASSIGNED_TO_SHIFT");

  const now = new Date();
  const { shift } = assignment;
  if (now > shift.endAtUtc) throw new Error("SHIFT_ENDED");

  await prisma.clockInVerificationCode.deleteMany({
    where: {
      staffUserId,
      shiftId,
      consumedAt: null,
    },
  });

  const expiresAt = new Date(now.getTime() + CLOCK_IN_CODE_TTL_MS);

  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomSixDigitCode();
    try {
      const row = await prisma.clockInVerificationCode.create({
        data: {
          code,
          staffUserId,
          shiftId,
          expiresAt,
        },
      });
      return { code: row.code, expiresAtUtc: row.expiresAt.toISOString() };
    } catch (e: unknown) {
      const isUnique =
        typeof e === "object" &&
        e !== null &&
        "code" in e &&
        (e as { code?: string }).code === "P2002";
      if (!isUnique) throw e;
    }
  }
  throw new Error("CODE_GENERATION_FAILED");
}

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
