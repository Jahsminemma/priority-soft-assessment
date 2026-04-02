import { Router } from "express";
import { CreateCoverageRequestSchema } from "@shiftsync/shared";
import {
  acceptCoverageRequest,
  approveCoverageRequest,
  cancelCoverageRequest,
  createCoverageRequest,
} from "../../application/coverage/index.js";
import { authMiddleware, requireRoles, type AuthedRequest } from "../middleware/index.js";
import { singleParam } from "../paramId.js";

export const coverageRouter = Router();

coverageRouter.post("/", authMiddleware, requireRoles("STAFF"), async (req: AuthedRequest, res) => {
  const parsed = CreateCoverageRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const uid = req.user?.id;
  if (!uid) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const out = await createCoverageRequest(uid, parsed.data);
    res.status(201).json(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "MAX_PENDING_COVERAGE") {
      res.status(400).json({
        error: "You can have at most 3 open swap or drop requests (waiting on a coworker or manager).",
      });
      return;
    }
    if (msg === "NOT_ASSIGNED_TO_SHIFT") {
      res.status(400).json({ error: "You are not assigned to this shift" });
      return;
    }
    if (msg === "INVALID_TARGET") {
      res.status(400).json({ error: "Invalid target" });
      return;
    }
    if (msg === "TARGET_NOT_ON_SECOND_SHIFT") {
      res.status(400).json({ error: "Target must be assigned to secondShiftId for a two-way swap" });
      return;
    }
    if (msg === "SWAP_ALREADY_PENDING") {
      res.status(400).json({
        error: "You already have a swap request in progress for this shift. Cancel it or wait until it is resolved.",
      });
      return;
    }
    throw e;
  }
});

coverageRouter.post("/:id/accept", authMiddleware, requireRoles("STAFF"), async (req: AuthedRequest, res) => {
  const uid = req.user?.id;
  if (!uid) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const rid = singleParam(req.params["id"]);
  if (!rid) {
    res.status(400).json({ error: "Missing id" });
    return;
  }
  const out = await acceptCoverageRequest(rid, uid);
  if (!out.ok) {
    const map: Record<string, number> = {
      NOT_PENDING: 409,
      SELF: 400,
      NOT_TARGET: 403,
      CONFLICT: 409,
      INVALID: 400,
    };
    res.status(map[out.code] ?? 400).json({ error: out.code });
    return;
  }
  res.json({ ok: true });
});

coverageRouter.post(
  "/:id/approve",
  authMiddleware,
  requireRoles("ADMIN", "MANAGER"),
  async (req: AuthedRequest, res) => {
    const uid = req.user?.id;
    if (!uid) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const rid = singleParam(req.params["id"]);
    if (!rid) {
      res.status(400).json({ error: "Missing id" });
      return;
    }
    const out = await approveCoverageRequest(rid, uid);
    if (!out.ok) {
      const status = out.code === "FORBIDDEN" ? 403 : out.code === "CONSTRAINTS" ? 400 : 400;
      res.status(status).json({ error: out.code });
      return;
    }
    res.json({ ok: true });
  },
);

coverageRouter.post("/:id/cancel", authMiddleware, requireRoles("STAFF"), async (req: AuthedRequest, res) => {
  const uid = req.user?.id;
  if (!uid) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const rid = singleParam(req.params["id"]);
  if (!rid) {
    res.status(400).json({ error: "Missing id" });
    return;
  }
  const out = await cancelCoverageRequest(rid, uid);
  if (!out.ok) {
    res.status(400).json({ error: "Cannot cancel" });
    return;
  }
  res.json({ ok: true });
});
