import { Router } from "express";
import { ClockInRequestSchema } from "@shiftsync/shared";
import { clockIn, clockOut } from "../../application/clock/index.js";
import { authMiddleware, requireRoles, type AuthedRequest } from "../middleware/index.js";

export const clockRouter = Router();

clockRouter.post("/in", authMiddleware, requireRoles("STAFF"), async (req: AuthedRequest, res) => {
  const uid = req.user?.id;
  if (!uid) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = ClockInRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const out = await clockIn(uid, parsed.data.shiftId);
    res.status(201).json(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "NOT_ASSIGNED_TO_SHIFT") {
      res.status(400).json({ error: msg });
      return;
    }
    if (msg === "SHIFT_ENDED") {
      res.status(400).json({ error: msg });
      return;
    }
    if (msg === "ALREADY_CLOCKED_IN") {
      res.status(409).json({ error: msg });
      return;
    }
    throw e;
  }
});

clockRouter.post("/out", authMiddleware, requireRoles("STAFF"), async (req: AuthedRequest, res) => {
  const uid = req.user?.id;
  if (!uid) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const out = await clockOut(uid);
    res.json(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "NO_OPEN_SESSION") {
      res.status(400).json({ error: msg });
      return;
    }
    throw e;
  }
});
