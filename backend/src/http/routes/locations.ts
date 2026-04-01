import { Router } from "express";
import { LocationSummarySchema } from "@shiftsync/shared";
import { listOnDutyForLocation } from "../../application/clock/index.js";
import { prisma } from "../../infrastructure/persistence/index.js";
import { canManageLocation } from "../../security/index.js";
import { authMiddleware, requireRoles, type AuthedRequest } from "../middleware/index.js";
import { singleParam } from "../paramId.js";

export const locationsRouter = Router();

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
