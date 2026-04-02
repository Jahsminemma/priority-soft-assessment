import { Router, type Response } from "express";
import { z } from "zod";
import { CreateCoverageRequestSchema } from "@shiftsync/shared";
import {
  acceptCoverageRequest,
  approveCoverageRequest,
  cancelCoverageRequest,
  createCoverageRequest,
  declineCoverageRequest,
  finalizeDropWithTarget,
  listManagerCoverageQueue,
  listOpenCalloutsForStaff,
} from "../../application/coverage/index.js";
import { authMiddleware, requireRoles, type AuthedRequest } from "../middleware/index.js";
import { singleParam } from "../paramId.js";

type CoverageFailure = { ok: false; code: string; messages?: string[] };

function sendCoverageFailureJson(res: Response, out: CoverageFailure, statusByCode: Record<string, number>): void {
  const status = statusByCode[out.code] ?? 400;
  const body: Record<string, unknown> = { error: out.code };
  if (out.messages?.length) {
    body.messages = out.messages;
    body.message = out.messages.join("\n\n");
  } else {
    const hints: Record<string, string> = {
      NOT_ELIGIBLE: "This person is not eligible for this shift (required skill or site certification).",
      FORBIDDEN: "You don’t have permission to do this.",
      NO_ASSIGNMENT: "The original assignment could not be found. The shift may have changed — refresh and try again.",
      NOT_PENDING: "This request is no longer pending.",
      CONFLICT: "This request was updated by someone else. Refresh and try again.",
      NOT_TARGET: "You are not the intended recipient for this request.",
      NOT_ACCEPTED: "This request is not ready for approval yet.",
      NO_TARGET: "No target is set for this request.",
      NO_TARGET_ASSIGNMENT: "The other person is no longer assigned to the trade shift.",
      DIRECTED_USE_ASSIGN: "This drop must be assigned by a manager.",
      INVALID: "This request is invalid or no longer exists.",
      SELF: "You can’t claim your own shift offer.",
    };
    const hint = hints[out.code];
    if (hint) body.message = hint;
  }
  res.status(status).json(body);
}

export const coverageRouter = Router();

coverageRouter.get("/open-callouts", authMiddleware, requireRoles("STAFF"), async (req: AuthedRequest, res) => {
  const uid = req.user?.id;
  if (!uid) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const rows = await listOpenCalloutsForStaff(uid);
  res.json(rows);
});

coverageRouter.get("/manager-queue", authMiddleware, requireRoles("ADMIN", "MANAGER"), async (req: AuthedRequest, res) => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const rows = await listManagerCoverageQueue({
    id: user.id,
    role: user.role,
    managerLocationIds: user.managerLocationIds,
  });
  res.json(rows);
});

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
    if (msg === "COVERAGE_ALREADY_PENDING_FOR_SHIFT") {
      res.status(400).json({
        error:
          "You already have an open swap or shift-offer request for this shift. Cancel it or wait until it is resolved.",
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
      DIRECTED_USE_ASSIGN: 400,
      FORBIDDEN: 403,
      NOT_ELIGIBLE: 400,
      CONSTRAINTS: 400,
    };
    sendCoverageFailureJson(res, out, map);
    return;
  }
  res.json({ ok: true });
});

coverageRouter.post("/:id/claim", authMiddleware, requireRoles("STAFF"), async (req: AuthedRequest, res) => {
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
      CONFLICT: 409,
      INVALID: 400,
      FORBIDDEN: 403,
      NOT_ELIGIBLE: 400,
      CONSTRAINTS: 400,
      NO_ASSIGNMENT: 409,
      DIRECTED_USE_ASSIGN: 400,
      NOT_TARGET: 403,
    };
    sendCoverageFailureJson(res, out, map);
    return;
  }
  res.json({ ok: true });
});

coverageRouter.post(
  "/:id/manager-assign",
  authMiddleware,
  requireRoles("ADMIN", "MANAGER"),
  async (req: AuthedRequest, res) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const rid = singleParam(req.params["id"]);
    if (!rid) {
      res.status(400).json({ error: "Missing id" });
      return;
    }
    const parsed = z.object({ targetUserId: z.string().uuid() }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const out = await finalizeDropWithTarget(rid, parsed.data.targetUserId, {
      id: user.id,
      role: user.role,
    });
    if (!out.ok) {
      const map: Record<string, number> = {
        NOT_PENDING: 409,
        CONFLICT: 409,
        CONSTRAINTS: 400,
        NOT_ELIGIBLE: 400,
        INVALID: 400,
        FORBIDDEN: 403,
        NO_ASSIGNMENT: 409,
      };
      sendCoverageFailureJson(res, out, map);
      return;
    }
    res.json({ ok: true });
  },
);

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
      const map: Record<string, number> = {
        FORBIDDEN: 403,
        NOT_ACCEPTED: 400,
        NO_TARGET: 400,
        NO_TARGET_ASSIGNMENT: 400,
        NO_ASSIGNMENT: 400,
        CONSTRAINTS: 400,
        INVALID: 400,
        CONFLICT: 409,
      };
      sendCoverageFailureJson(res, out, map);
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

coverageRouter.post("/:id/decline", authMiddleware, requireRoles("STAFF"), async (req: AuthedRequest, res) => {
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
  const out = await declineCoverageRequest(rid, uid);
  if (!out.ok) {
    const map: Record<string, number> = {
      NOT_PENDING: 409,
      SELF: 400,
      NOT_TARGET: 403,
      INVALID: 400,
    };
    res.status(map[out.code] ?? 400).json({ error: out.code });
    return;
  }
  res.json({ ok: true });
});
