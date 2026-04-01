import { Router } from "express";
import { z } from "zod";
import { LocationSummarySchema } from "@shiftsync/shared";
import { listOnDutyForLocation } from "../../application/clock/index.js";
import { prisma } from "../../infrastructure/persistence/index.js";
import { canManageLocation } from "../../security/index.js";
import { authMiddleware, requireRoles, type AuthedRequest } from "../middleware/index.js";
import { singleParam } from "../paramId.js";

export const locationsRouter = Router();

const RosterCandidateSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
});

locationsRouter.get(
  "/:locationId/roster-candidates",
  authMiddleware,
  requireRoles("ADMIN", "MANAGER"),
  async (req: AuthedRequest, res) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const locationId = singleParam(req.params["locationId"]);
    if (!locationId) {
      res.status(400).json({ error: "Missing location id" });
      return;
    }
    if (!canManageLocation(user, locationId)) {
      res.status(403).json({ error: "Forbidden for this location" });
      return;
    }
    const skillId = req.query["skillId"];
    if (typeof skillId !== "string" || !skillId) {
      res.status(400).json({ error: "Missing skillId query" });
      return;
    }
    const parsed = z.string().uuid().safeParse(skillId);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid skillId" });
      return;
    }
    const rows = await prisma.user.findMany({
      where: {
        role: "STAFF",
        staffSkills: { some: { skillId: parsed.data } },
        certifications: { some: { locationId } },
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    res.json(rows.map((r) => RosterCandidateSchema.parse(r)));
  },
);

locationsRouter.get(
  "/:locationId/on-duty",
  authMiddleware,
  requireRoles("ADMIN", "MANAGER"),
  async (req: AuthedRequest, res) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const locationId = singleParam(req.params["locationId"]);
    if (!locationId) {
      res.status(400).json({ error: "Missing location id" });
      return;
    }
    if (!canManageLocation(user, locationId)) {
      res.status(403).json({ error: "Forbidden for this location" });
      return;
    }
    const rows = await listOnDutyForLocation(locationId);
    res.json(rows);
  },
);

locationsRouter.get("/", authMiddleware, async (req: AuthedRequest, res) => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (user.role === "STAFF") {
    const rows = await prisma.staffCertification.findMany({
      where: { userId: user.id },
      include: { location: true },
      orderBy: { location: { name: "asc" } },
    });
    const out = rows.map((r) => LocationSummarySchema.parse(r.location));
    res.json(out);
    return;
  }

  if (user.role === "ADMIN") {
    const rows = await prisma.location.findMany({ orderBy: { name: "asc" } });
    const out = rows.map((r) => LocationSummarySchema.parse(r));
    res.json(out);
    return;
  }

  if (user.role === "MANAGER") {
    if (user.managerLocationIds.length === 0) {
      res.json([]);
      return;
    }
    const rows = await prisma.location.findMany({
      where: { id: { in: user.managerLocationIds } },
      orderBy: { name: "asc" },
    });
    const out = rows.map((r) => LocationSummarySchema.parse(r));
    res.json(out);
    return;
  }

  res.status(403).json({ error: "Forbidden" });
});
