import { Router } from "express";
import { AuditExportQuerySchema } from "@shiftsync/shared";
import { exportAuditLogs, listAuditForShift } from "../../application/audit/index.js";
import { authMiddleware, requireRoles, type AuthedRequest } from "../middleware/index.js";
import { singleParam } from "../paramId.js";

export const auditRouter = Router();

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
