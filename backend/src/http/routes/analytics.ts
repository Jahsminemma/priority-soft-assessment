import { Router } from "express";
import { LocationWeekQuerySchema } from "@shiftsync/shared";
import { fairnessReport, overtimeWeekReport } from "../../application/analytics/index.js";
import { authMiddleware, requireRoles, type AuthedRequest } from "../middleware/index.js";

export const analyticsRouter = Router();

analyticsRouter.get(
  "/fairness",
  authMiddleware,
  requireRoles("ADMIN", "MANAGER"),
  async (req: AuthedRequest, res) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const parsed = LocationWeekQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const rows = await fairnessReport(user, parsed.data.locationId, parsed.data.weekKey);
    if (rows === null) {
      res.status(403).json({ error: "Forbidden for this location" });
      return;
    }
    res.json(rows);
  },
);

analyticsRouter.get(
  "/overtime/week",
  authMiddleware,
  requireRoles("ADMIN", "MANAGER"),
  async (req: AuthedRequest, res) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const parsed = LocationWeekQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const rows = await overtimeWeekReport(user, parsed.data.locationId, parsed.data.weekKey);
    if (rows === null) {
      res.status(403).json({ error: "Forbidden for this location" });
      return;
    }
    res.json(rows);
  },
);
