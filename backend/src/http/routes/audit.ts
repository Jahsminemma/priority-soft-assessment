import { Router } from "express";
import { AuditExportQuerySchema, AuditListQuerySchema } from "@shiftsync/shared";
import { exportAuditLogs, listAuditForLocation, listAuditForShift } from "../../application/audit/index.js";
import { authMiddleware, requireRoles, type AuthedRequest } from "../middleware/index.js";
import { singleParam } from "../paramId.js";

export const auditRouter = Router();

auditRouter.get(
  "/list",
  authMiddleware,
  requireRoles("ADMIN"),
  async (req: AuthedRequest, res) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const parsed = AuditListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const now = new Date();
    const from = parsed.data.from ? new Date(parsed.data.from) : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const to = parsed.data.to ? new Date(parsed.data.to) : now;
    const locId = parsed.data.locationId;
    const listOpts: { from: Date; to: Date; locationId?: string } = { from, to };
    if (locId) listOpts.locationId = locId;
    const rows = await listAuditForLocation(user, listOpts);
    if (rows === null) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    res.json(rows);
  },
);

auditRouter.get(
  "/shifts/:shiftId",
  authMiddleware,
  requireRoles("ADMIN", "MANAGER"),
  async (req: AuthedRequest, res) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const shiftId = singleParam(req.params["shiftId"]);
    if (!shiftId) {
      res.status(400).json({ error: "Missing shift id" });
      return;
    }
    const rows = await listAuditForShift(user, shiftId);
    if (rows === null) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(rows);
  },
);

auditRouter.get("/export", authMiddleware, requireRoles("ADMIN"), async (req: AuthedRequest, res) => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = AuditExportQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const from = new Date(parsed.data.from);
  const to = new Date(parsed.data.to);
  const rows = await exportAuditLogs(user, from, to, parsed.data.locationId);
  if (rows === null) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  res.json(rows);
});
