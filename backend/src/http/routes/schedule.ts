import { Router } from "express";
import { PublishWeekRequestSchema, UnpublishWeekRequestSchema } from "@shiftsync/shared";
import { publishWeek, unpublishWeek } from "../../application/schedule/index.js";
import { authMiddleware, requireRoles, type AuthedRequest } from "../middleware/index.js";

export const scheduleRouter = Router();

scheduleRouter.post(
  "/publish",
  authMiddleware,
  requireRoles("ADMIN", "MANAGER"),
  async (req: AuthedRequest, res) => {
    const parsed = PublishWeekRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    try {
      const out = await publishWeek(user, parsed.data.locationId, parsed.data.weekKey, parsed.data.cutoffHours);
      if (out === null) {
        res.status(403).json({ error: "Forbidden for this location" });
        return;
      }
      res.json(out);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "LOCATION_NOT_FOUND") {
        res.status(404).json({ error: msg });
        return;
      }
      if (msg === "INVALID_WEEK_KEY") {
        res.status(400).json({ error: "Invalid weekKey (use e.g. 2026-W09)" });
        return;
      }
      throw e;
    }
  },
);

scheduleRouter.post(
  "/unpublish",
  authMiddleware,
  requireRoles("ADMIN", "MANAGER"),
  async (req: AuthedRequest, res) => {
    const parsed = UnpublishWeekRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    try {
      const out = await unpublishWeek(user, parsed.data.locationId, parsed.data.weekKey);
      if (out === null) {
        res.status(403).json({ error: "Forbidden for this location" });
        return;
      }
      res.json(out);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "LOCATION_NOT_FOUND") {
        res.status(404).json({ error: msg });
        return;
      }
      if (msg === "INVALID_WEEK_KEY") {
        res.status(400).json({ error: "Invalid weekKey" });
        return;
      }
      throw e;
    }
  },
);
