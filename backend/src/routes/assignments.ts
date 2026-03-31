import { Router } from "express";
import {
  AssignmentCommitRequestSchema,
  AssignmentPreviewRequestSchema,
} from "@shiftsync/shared";
import { authMiddleware, requireRoles, type AuthedRequest } from "../middleware/auth.js";
import { commitAssignment, previewAssignment } from "../services/assignmentService.js";

export const assignmentsRouter = Router();

assignmentsRouter.post(
  "/preview",
  authMiddleware,
  requireRoles("ADMIN", "MANAGER"),
  async (req: AuthedRequest, res) => {
    const parsed = AssignmentPreviewRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const out = await previewAssignment(parsed.data.shiftId, parsed.data.staffUserId);
    res.json(out);
  },
);

assignmentsRouter.post(
  "/commit",
  authMiddleware,
  requireRoles("ADMIN", "MANAGER"),
  async (req: AuthedRequest, res) => {
    const parsed = AssignmentCommitRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const actorId = req.user?.id;
    if (!actorId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const out = await commitAssignment(
      parsed.data.shiftId,
      parsed.data.staffUserId,
      parsed.data.idempotencyKey,
      parsed.data.seventhDayOverrideReason,
      actorId,
    );
    res.json(out);
  },
);
