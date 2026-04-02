import { Router } from "express";
import {
  ClockCodeLookupSchema,
  ClockInCodeRequestSchema,
  ClockInRequestSchema,
} from "@shiftsync/shared";
import {
  approveClockInCode,
  clockIn,
  clockOut,
  listMyClockSessions,
  previewClockInCode,
  requestClockInCode,
} from "../../application/clock/index.js";
import { authMiddleware, requireRoles, type AuthedRequest } from "../middleware/index.js";

export const clockRouter = Router();

clockRouter.post("/preview-code", authMiddleware, requireRoles("ADMIN", "MANAGER"), async (req: AuthedRequest, res) => {
  const u = req.user;
  if (!u) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = ClockCodeLookupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const managerRole = u.role === "ADMIN" ? "ADMIN" : "MANAGER";
    const out = await previewClockInCode(parsed.data.code, managerRole, u.managerLocationIds);
    res.json(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "INVALID_CODE") {
      res.status(400).json({ error: msg });
      return;
    }
    if (msg === "CODE_NOT_FOUND") {
      res.status(404).json({ error: msg });
      return;
    }
    if (msg === "CODE_EXPIRED") {
      res.status(410).json({ error: msg });
      return;
    }
    if (msg === "CODE_ALREADY_USED") {
      res.status(409).json({ error: msg });
      return;
    }
    throw e;
  }
});

clockRouter.post("/approve-code", authMiddleware, requireRoles("ADMIN", "MANAGER"), async (req: AuthedRequest, res) => {
  const u = req.user;
  if (!u) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = ClockCodeLookupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const out = await approveClockInCode(parsed.data.code, u.id);
    res.status(201).json(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "INVALID_CODE") {
      res.status(400).json({ error: msg });
      return;
    }
    if (msg === "CODE_NOT_FOUND") {
      res.status(404).json({ error: msg });
      return;
    }
    if (msg === "CODE_EXPIRED") {
      res.status(410).json({ error: msg });
      return;
    }
    if (msg === "CODE_ALREADY_USED") {
      res.status(409).json({ error: msg });
      return;
    }
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

clockRouter.get("/my-sessions", authMiddleware, requireRoles("STAFF"), async (req: AuthedRequest, res) => {
  const uid = req.user?.id;
  if (!uid) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const rows = await listMyClockSessions(uid);
  res.json(rows);
});

clockRouter.post("/request-code", authMiddleware, requireRoles("STAFF"), async (req: AuthedRequest, res) => {
  const uid = req.user?.id;
  if (!uid) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = ClockInCodeRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const out = await requestClockInCode(uid, parsed.data.shiftId);
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
    if (msg === "CODE_GENERATION_FAILED") {
      res.status(503).json({ error: msg });
      return;
    }
    throw e;
  }
});

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
