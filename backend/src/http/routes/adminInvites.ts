import { randomBytes, createHash } from "crypto";
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { CreateInviteRequestSchema, StaffLocationsPatchRequestSchema } from "@shiftsync/shared";
import { prisma } from "../../infrastructure/persistence/index.js";
import { authMiddleware, requireRoles, type AuthedRequest } from "../middleware/index.js";

export const adminInvitesRouter = Router();

function mapTeamResponse(
  managers: Array<{
    id: string;
    name: string;
    email: string;
    managerLocations: Array<{ location: { id: string; name: string } }>;
  }>,
  staff: Array<{
    id: string;
    name: string;
    email: string;
    desiredHoursWeekly: number | null;
    staffSkills: Array<{ skill: { id: string; name: string } }>;
    certifications: Array<{ location: { id: string; name: string } }>;
  }>,
): { managers: unknown[]; staff: unknown[] } {
  return {
    managers: managers.map((m) => ({
      id: m.id,
      name: m.name,
      email: m.email,
      locations: m.managerLocations.map((ml) => ({
        id: ml.location.id,
        name: ml.location.name,
      })),
      skills: [] as { id: string; name: string }[],
    })),
    staff: staff.map((s) => ({
      id: s.id,
      name: s.name,
      email: s.email,
      desiredHoursWeekly: s.desiredHoursWeekly,
      skills: s.staffSkills.map((ss) => ({ id: ss.skill.id, name: ss.skill.name })),
      locations: s.certifications.map((c) => ({ id: c.location.id, name: c.location.name })),
    })),
  };
}

adminInvitesRouter.get(
  "/team",
  authMiddleware,
  requireRoles("ADMIN", "MANAGER"),
  async (req: AuthedRequest, res): Promise<void> => {
    const actor = req.user;
    if (!actor) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    try {
      if (actor.role === "ADMIN") {
        const [managers, staff] = await Promise.all([
          prisma.user.findMany({
            where: { role: "MANAGER" },
            orderBy: { name: "asc" },
            include: {
              managerLocations: { include: { location: true } },
            },
          }),
          prisma.user.findMany({
            where: { role: "STAFF" },
            orderBy: { name: "asc" },
            include: {
              staffSkills: { include: { skill: true } },
              certifications: { include: { location: true } },
            },
          }),
        ]);
        res.json(mapTeamResponse(managers, staff));
        return;
      }

      const managedIds = actor.managerLocationIds;
      if (managedIds.length === 0) {
        res.json({ managers: [], staff: [] });
        return;
      }

      const [managers, staff] = await Promise.all([
        prisma.user.findMany({
          where: {
            role: "MANAGER",
            managerLocations: { some: { locationId: { in: managedIds } } },
          },
          orderBy: { name: "asc" },
          include: {
            managerLocations: { include: { location: true } },
          },
        }),
        prisma.user.findMany({
          where: {
            role: "STAFF",
            certifications: { some: { locationId: { in: managedIds } } },
          },
          orderBy: { name: "asc" },
          include: {
            staffSkills: { include: { skill: true } },
            certifications: { include: { location: true } },
          },
        }),
      ]);
      res.json(mapTeamResponse(managers, staff));
    } catch (err) {
      console.error("[admin/team]", err);
      res.status(500).json({ error: "Could not load team." });
    }
  },
);

adminInvitesRouter.patch(
  "/staff/:userId/locations",
  authMiddleware,
  requireRoles("ADMIN"),
  async (req: AuthedRequest, res): Promise<void> => {
    try {
      const rawId = req.params["userId"];
      const staffUserId = typeof rawId === "string" ? rawId : undefined;
      if (!staffUserId) {
        res.status(400).json({ error: "Missing user id." });
        return;
      }
      const parsedBody = StaffLocationsPatchRequestSchema.safeParse(req.body);
      if (!parsedBody.success) {
        res.status(400).json({ error: parsedBody.error.flatten() });
        return;
      }
      const { locationIds } = parsedBody.data;

      const target = await prisma.user.findUnique({ where: { id: staffUserId } });
      if (!target || target.role !== "STAFF") {
        res.status(404).json({ error: "Staff member not found." });
        return;
      }

      const count = await prisma.location.count({ where: { id: { in: locationIds } } });
      if (count !== locationIds.length) {
        res.status(400).json({ error: "One or more locations are invalid." });
        return;
      }

      await prisma.$transaction(async (tx) => {
        await tx.staffCertification.deleteMany({ where: { userId: staffUserId } });
        await tx.staffCertification.createMany({
          data: locationIds.map((locationId) => ({ userId: staffUserId, locationId })),
        });
      });

      res.json({ ok: true });
    } catch (err) {
      console.error("[admin/staff/locations]", err);
      res.status(500).json({ error: "Could not update locations." });
    }
  },
);

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

adminInvitesRouter.post(
  "/invites",
  authMiddleware,
  requireRoles("ADMIN"),
  async (req: AuthedRequest, res): Promise<void> => {
    try {
      const parsed = CreateInviteRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      const { email, name, role, desiredHoursWeekly, managerLocationIds, staffSkillIds, staffLocationIds } =
        parsed.data;
      const emailNorm = email.toLowerCase();

      const existingUser = await prisma.user.findUnique({ where: { email: emailNorm } });
      if (existingUser) {
        res.status(409).json({ error: "That email already has an account." });
        return;
      }

      const pending = await prisma.registrationInvite.findFirst({
        where: { email: emailNorm, consumedAt: null },
      });
      if (pending && pending.expiresAt > new Date()) {
        res.status(409).json({ error: "An invite is already pending for this email." });
        return;
      }
      if (pending) {
        await prisma.registrationInvite.delete({ where: { id: pending.id } });
      }

      if (role === "MANAGER" && managerLocationIds?.length) {
        const count = await prisma.location.count({ where: { id: { in: managerLocationIds } } });
        if (count !== managerLocationIds.length) {
          res.status(400).json({ error: "One or more locations are invalid." });
          return;
        }
      }

      if (role === "STAFF" && staffSkillIds?.length) {
        const count = await prisma.skill.count({ where: { id: { in: staffSkillIds } } });
        if (count !== staffSkillIds.length) {
          res.status(400).json({ error: "One or more skills are invalid." });
          return;
        }
      }

      if (role === "STAFF" && staffLocationIds?.length) {
        const count = await prisma.location.count({ where: { id: { in: staffLocationIds } } });
        if (count !== staffLocationIds.length) {
          res.status(400).json({ error: "One or more locations are invalid." });
          return;
        }
      }

      const plainToken = randomBytes(32).toString("hex");
      const tokenHash = hashToken(plainToken);
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      await prisma.registrationInvite.create({
        data: {
          tokenHash,
          email: emailNorm,
          name,
          role,
          desiredHoursWeekly: role === "STAFF" ? desiredHoursWeekly ?? null : null,
          managerLocationIds:
            role === "MANAGER" ? (managerLocationIds ?? []) : Prisma.JsonNull,
          staffSkillIds:
            role === "STAFF" ? (staffSkillIds ?? []) : Prisma.JsonNull,
          staffLocationIds:
            role === "STAFF" ? (staffLocationIds ?? []) : Prisma.JsonNull,
          expiresAt,
          createdById: req.user!.id,
        },
      });

      res.json({
        token: plainToken,
        expiresAt: expiresAt.toISOString(),
      });
    } catch (err) {
      console.error("[admin/invites]", err);
      res.status(500).json({
        error:
          "Could not create invite. Ensure the database is migrated (npm run db:migrate from the repo root).",
      });
    }
  },
);
