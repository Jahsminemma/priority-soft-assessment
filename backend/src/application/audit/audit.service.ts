import { prisma } from "../../infrastructure/persistence/index.js";
import { canManageLocation, type AuthedUser } from "../../security/index.js";
import { normalizeIsoWeekKey } from "@shiftsync/shared";

export type AuditLogRowDto = {
  id: string;
  actorUserId: string;
  actorName: string;
  actorRole: "ADMIN" | "MANAGER" | "STAFF" | "SYSTEM";
  entityType: string;
  entityId: string;
  action: string;
  beforeJson: unknown;
  afterJson: unknown;
  createdAt: string;
  locationId: string | null;
  locationName: string | null;
};

type RawRow = {
  id: string;
  actorUserId: string;
  entityType: string;
  entityId: string;
  action: string;
  beforeJson: unknown;
  afterJson: unknown;
  createdAt: Date;
};

type UserMeta = { id: string; name: string; role: "ADMIN" | "MANAGER" | "STAFF" };

type RefIdBuckets = {
  userIds: Set<string>;
  locationIds: Set<string>;
  skillIds: Set<string>;
  shiftIds: Set<string>;
};

type DisplayEnrichMaps = {
  userNameById: Map<string, string>;
  locationNameById: Map<string, string>;
  skillNameById: Map<string, string>;
  shiftLabelById: Map<string, string>;
};

function looksLikeUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function collectReferenceIds(value: unknown, acc: RefIdBuckets): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const x of value) collectReferenceIds(x, acc);
    return;
  }
  if (typeof value !== "object") return;
  const o = value as Record<string, unknown>;
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === "string" && looksLikeUuid(v)) {
      if (
        k === "staffUserId" ||
        k === "actorUserId" ||
        k === "userId" ||
        k === "requesterUserId" ||
        k === "targetUserId" ||
        k === "requesterId" ||
        k === "targetId" ||
        k === "proposedTargetId"
      ) {
        acc.userIds.add(v);
      } else if (k === "locationId") {
        acc.locationIds.add(v);
      } else if (k === "requiredSkillId" || k === "skillId") {
        acc.skillIds.add(v);
      } else if (k === "shiftId" || k === "secondShiftId") {
        acc.shiftIds.add(v);
      }
    } else if (typeof v === "object") {
      collectReferenceIds(v, acc);
    }
  }
}

function formatShiftRangeUtc(startAtUtc: Date, endAtUtc: Date): string {
  const fmt = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ");
  return `${fmt(startAtUtc)}–${fmt(endAtUtc)} UTC`;
}

async function buildDisplayEnrichMaps(buckets: RefIdBuckets, viewingShiftId: string): Promise<DisplayEnrichMaps> {
  const [users, locs, skills, shifts] = await Promise.all([
    buckets.userIds.size > 0
      ? prisma.user.findMany({
          where: { id: { in: [...buckets.userIds] } },
          select: { id: true, name: true },
        })
      : [],
    buckets.locationIds.size > 0
      ? prisma.location.findMany({
          where: { id: { in: [...buckets.locationIds] } },
          select: { id: true, name: true },
        })
      : [],
    buckets.skillIds.size > 0
      ? prisma.skill.findMany({
          where: { id: { in: [...buckets.skillIds] } },
          select: { id: true, name: true },
        })
      : [],
    buckets.shiftIds.size > 0
      ? prisma.shift.findMany({
          where: { id: { in: [...buckets.shiftIds] } },
          select: { id: true, startAtUtc: true, endAtUtc: true },
        })
      : [],
  ]);

  const shiftLabelById = new Map<string, string>();
  for (const s of shifts) {
    const label =
      s.id === viewingShiftId ? "This shift" : formatShiftRangeUtc(s.startAtUtc, s.endAtUtc);
    shiftLabelById.set(s.id, label);
  }

  return {
    userNameById: new Map(users.map((u) => [u.id, u.name.trim() !== "" ? u.name.trim() : u.id])),
    locationNameById: new Map(locs.map((l) => [l.id, l.name])),
    skillNameById: new Map(skills.map((sk) => [sk.id, sk.name])),
    shiftLabelById,
  };
}

function enrichAuditJson(value: unknown, maps: DisplayEnrichMaps, viewingShiftId: string): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((x) => enrichAuditJson(x, maps, viewingShiftId));
  if (typeof value !== "object") return value;
  const o = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === "string" && looksLikeUuid(v)) {
      if (
        k === "staffUserId" ||
        k === "actorUserId" ||
        k === "userId" ||
        k === "requesterUserId" ||
        k === "targetUserId" ||
        k === "requesterId" ||
        k === "targetId" ||
        k === "proposedTargetId"
      ) {
        out[k] = maps.userNameById.get(v) ?? v;
      } else if (k === "locationId") {
        out[k] = maps.locationNameById.get(v) ?? v;
      } else if (k === "requiredSkillId" || k === "skillId") {
        out[k] = maps.skillNameById.get(v) ?? v;
      } else if (k === "shiftId" || k === "secondShiftId") {
        if (v === viewingShiftId) out[k] = "This shift";
        else out[k] = maps.shiftLabelById.get(v) ?? v;
      } else {
        out[k] = v;
      }
    } else if (typeof v === "object") {
      out[k] = enrichAuditJson(v, maps, viewingShiftId);
    } else {
      out[k] = v;
    }
  }
  return out;
}

async function actorMetaMap(actorUserIds: string[]): Promise<Map<string, UserMeta>> {
  if (actorUserIds.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(actorUserIds)] } },
    select: { id: true, name: true, role: true },
  });
  return new Map(users.map((u) => [u.id, u as UserMeta]));
}


function resolveLocation(
  r: RawRow,
  locById: Map<string, { id: string; name: string }>,
  shiftToLoc: Map<string, string>,
): { locationId: string | null; locationName: string | null } {
  if (r.entityType === "ScheduleWeek") {
    const locId = r.entityId.split(":")[0] ?? null;
    const loc = locId ? locById.get(locId) : undefined;
    return { locationId: loc?.id ?? null, locationName: loc?.name ?? null };
  }
  if (r.entityType === "Shift") {
    const locId = shiftToLoc.get(r.entityId) ?? null;
    const loc = locId ? locById.get(locId) : undefined;
    return { locationId: loc?.id ?? null, locationName: loc?.name ?? null };
  }
  if (r.entityType === "ShiftAssignment" || r.entityType === "CoverageRequest") {
    const json = (r.afterJson ?? r.beforeJson) as Record<string, unknown> | null;
    const sid = typeof json?.["shiftId"] === "string" ? json["shiftId"] : null;
    const locId = sid ? shiftToLoc.get(sid) ?? null : null;
    const loc = locId ? locById.get(locId) : undefined;
    return { locationId: loc?.id ?? null, locationName: loc?.name ?? null };
  }
  return { locationId: null, locationName: null };
}

async function buildLocationLookups(rows: RawRow[]): Promise<{
  locById: Map<string, { id: string; name: string }>;
  shiftToLoc: Map<string, string>;
}> {
  const shiftIds = new Set<string>();

  for (const r of rows) {
    if (r.entityType === "Shift") {
      shiftIds.add(r.entityId);
    } else if (r.entityType === "ShiftAssignment" || r.entityType === "CoverageRequest") {
      const json = (r.afterJson ?? r.beforeJson) as Record<string, unknown> | null;
      const sid = json?.["shiftId"];
      if (typeof sid === "string") shiftIds.add(sid);
    }
  }

  const locationIds = new Set<string>();
  const shiftToLoc = new Map<string, string>();

  if (shiftIds.size > 0) {
    const shifts = await prisma.shift.findMany({
      where: { id: { in: [...shiftIds] } },
      select: { id: true, locationId: true },
    });
    for (const s of shifts) {
      shiftToLoc.set(s.id, s.locationId);
      locationIds.add(s.locationId);
    }
  }

  for (const r of rows) {
    if (r.entityType === "ScheduleWeek") {
      const locId = r.entityId.split(":")[0];
      if (locId) locationIds.add(locId);
    }
  }

  const locs = locationIds.size > 0
    ? await prisma.location.findMany({ where: { id: { in: [...locationIds] } }, select: { id: true, name: true } })
    : [];

  const locById = new Map(locs.map((l) => [l.id, l]));
  return { locById, shiftToLoc };
}

function toDto(
  rows: RawRow[],
  meta: Map<string, UserMeta>,
  locById: Map<string, { id: string; name: string }>,
  shiftToLoc: Map<string, string>,
  enrich?: { maps: DisplayEnrichMaps; viewingShiftId: string },
): AuditLogRowDto[] {
  return rows.map((r) => {
    const actor = meta.get(r.actorUserId);
    const { locationId, locationName } = resolveLocation(r, locById, shiftToLoc);
    return {
      id: r.id,
      actorUserId: r.actorUserId,
      actorName: actor?.name ?? "System",
      actorRole: actor?.role ?? "SYSTEM",
      entityType: r.entityType,
      entityId: r.entityId,
      action: r.action,
      beforeJson: enrich ? enrichAuditJson(r.beforeJson, enrich.maps, enrich.viewingShiftId) : (r.beforeJson ?? null),
      afterJson: enrich ? enrichAuditJson(r.afterJson, enrich.maps, enrich.viewingShiftId) : (r.afterJson ?? null),
      createdAt: r.createdAt.toISOString(),
      locationId,
      locationName,
    };
  });
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
        { entityType: "ShiftAssignment", afterJson: { path: ["shiftId"], equals: shiftId } },
        { entityType: "ShiftAssignment", beforeJson: { path: ["shiftId"], equals: shiftId } },
        { entityType: "CoverageRequest", afterJson: { path: ["shiftId"], equals: shiftId } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: 200,
  });

  const meta = await actorMetaMap(rows.map((r) => r.actorUserId));
  const { locById, shiftToLoc } = await buildLocationLookups(rows);

  const buckets: RefIdBuckets = {
    userIds: new Set(),
    locationIds: new Set(),
    skillIds: new Set(),
    shiftIds: new Set(),
  };
  for (const r of rows) {
    collectReferenceIds(r.beforeJson, buckets);
    collectReferenceIds(r.afterJson, buckets);
  }
  const displayMaps = await buildDisplayEnrichMaps(buckets, shiftId);
  return toDto(rows, meta, locById, shiftToLoc, { maps: displayMaps, viewingShiftId: shiftId });
}

export async function listAuditForLocation(
  actor: AuthedUser,
  opts: {
    locationId?: string;
    from: Date;
    to: Date;
  },
): Promise<AuditLogRowDto[] | null> {
  const { locationId, from, to } = opts;

  if (locationId && !canManageLocation(actor, locationId)) return null;
  if (!locationId && actor.role !== "ADMIN") {
    if (actor.managerLocationIds.length === 0) return [];
  }

  let rows: RawRow[];

  if (locationId) {
    const scheduleIdPrefix = `${locationId}:`;
    rows = await prisma.$queryRaw<RawRow[]>`
      SELECT a.id, a."actorUserId", a."entityType", a."entityId", a.action, a."beforeJson", a."afterJson", a."createdAt"
      FROM "AuditLog" a
      WHERE a."createdAt" >= ${from}
        AND a."createdAt" <= ${to}
        AND (
          (a."entityType" = 'ScheduleWeek' AND a."entityId" LIKE ${`${scheduleIdPrefix}%`})
          OR (
            a."entityType" = 'Shift'
            AND a."entityId" IN (SELECT s.id::text FROM "Shift" s WHERE s."locationId" = ${locationId}::uuid)
          )
          OR (
            a."entityType" = 'ShiftAssignment'
            AND (
              (a."afterJson"->>'shiftId') IN (SELECT s.id::text FROM "Shift" s WHERE s."locationId" = ${locationId}::uuid)
              OR (a."beforeJson"->>'shiftId') IN (SELECT s.id::text FROM "Shift" s WHERE s."locationId" = ${locationId}::uuid)
            )
          )
          OR (
            a."entityType" = 'CoverageRequest'
            AND (
              (a."afterJson"->>'shiftId') IN (SELECT s.id::text FROM "Shift" s WHERE s."locationId" = ${locationId}::uuid)
            )
          )
        )
      ORDER BY a."createdAt" DESC
      LIMIT 2000
    `;
  } else if (actor.role === "ADMIN") {
    rows = (await prisma.auditLog.findMany({
      where: { createdAt: { gte: from, lte: to } },
      orderBy: { createdAt: "desc" },
      take: 2000,
      select: { id: true, actorUserId: true, entityType: true, entityId: true, action: true, beforeJson: true, afterJson: true, createdAt: true },
    })) as RawRow[];
  } else {
    const locIds = actor.managerLocationIds;
    const locIdsStr = locIds.join(",");
    if (!locIdsStr) return [];
    rows = await prisma.$queryRaw<RawRow[]>`
      SELECT a.id, a."actorUserId", a."entityType", a."entityId", a.action, a."beforeJson", a."afterJson", a."createdAt"
      FROM "AuditLog" a
      WHERE a."createdAt" >= ${from}
        AND a."createdAt" <= ${to}
        AND (
          (a."entityType" = 'ScheduleWeek' AND (${locIds.map((id) => `a."entityId" LIKE '${id}:%'`).join(" OR ")}))
          OR (
            a."entityType" IN ('Shift', 'ShiftAssignment', 'CoverageRequest')
            AND a."entityId" IN (SELECT s.id::text FROM "Shift" s WHERE s."locationId" = ANY(${locIds}::uuid[]))
          )
        )
      ORDER BY a."createdAt" DESC
      LIMIT 2000
    `;
  }

  const meta = await actorMetaMap(rows.map((r) => r.actorUserId));
  const { locById, shiftToLoc } = await buildLocationLookups(rows);
  return toDto(rows, meta, locById, shiftToLoc);
}

export async function exportAuditLogs(
  actor: AuthedUser,
  from: Date,
  to: Date,
  locationId?: string,
): Promise<AuditLogRowDto[] | null> {
  if (actor.role !== "ADMIN") return null;

  let rows: RawRow[];

  if (locationId) {
    const loc = await prisma.location.findUnique({ where: { id: locationId } });
    if (!loc) return [];

    const scheduleIdPrefix = `${locationId}:`;

    rows = await prisma.$queryRaw<RawRow[]>`
      SELECT a.id, a."actorUserId", a."entityType", a."entityId", a.action, a."beforeJson", a."afterJson", a."createdAt"
      FROM "AuditLog" a
      WHERE a."createdAt" >= ${from}
        AND a."createdAt" <= ${to}
        AND (
          (a."entityType" = 'ScheduleWeek' AND a."entityId" LIKE ${`${scheduleIdPrefix}%`})
          OR (
            a."entityType" = 'Shift'
            AND a."entityId" IN (SELECT s.id::text FROM "Shift" s WHERE s."locationId" = ${locationId}::uuid)
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
    rows = (await prisma.auditLog.findMany({
      where: { createdAt: { gte: from, lte: to } },
      orderBy: { createdAt: "desc" },
      take: 5000,
      select: { id: true, actorUserId: true, entityType: true, entityId: true, action: true, beforeJson: true, afterJson: true, createdAt: true },
    })) as RawRow[];
  }

  const meta = await actorMetaMap(rows.map((r) => r.actorUserId));
  const { locById, shiftToLoc } = await buildLocationLookups(rows);
  return toDto(rows, meta, locById, shiftToLoc);
}
