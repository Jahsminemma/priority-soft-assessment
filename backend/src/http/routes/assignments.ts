import { Router, type Response } from "express";
import {
  AssignmentCommitRequestSchema,
  AssignmentPreviewRequestSchema,
} from "@shiftsync/shared";
import { commitAssignment, previewAssignment, removeAssignment } from "../../application/assignments/index.js";
import { prisma } from "../../infrastructure/persistence/index.js";
import { canManageLocation } from "../../security/index.js";
import { authMiddleware, requireRoles, type AuthedRequest } from "../middleware/index.js";
import { singleParam } from "../paramId.js";

export const assignmentsRouter = Router();

async function assertCanManageShift(
  req: AuthedRequest,
  shiftId: string,
  res: Response,
): Promise<boolean> {
  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
    select: { locationId: true },
  });
  if (!shift) {
    res.status(404).json({ error: "Shift not found" });
    return false;
  }
  const user = req.user;
  if (!user || !canManageLocation(user, shift.locationId)) {
    res.status(403).json({ error: "Forbidden for this shift's location" });
    return false;
  }
  return true;
}

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
    if (!(await assertCanManageShift(req, parsed.data.shiftId, res))) return;
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const out = await previewAssignment(parsed.data.shiftId, parsed.data.staffUserId, user, {
      emergencyOverrideReason: parsed.data.emergencyOverrideReason,
      seventhDayOverrideReason: parsed.data.seventhDayOverrideReason,
    });
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

    const actor = req.user;
    if (!actor) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (!(await assertCanManageShift(req, parsed.data.shiftId, res))) return;

    const out = await commitAssignment(
      parsed.data.shiftId,
      parsed.data.staffUserId,
      parsed.data.idempotencyKey,
      parsed.data.seventhDayOverrideReason,
      actor,
      { emergencyOverrideReason: parsed.data.emergencyOverrideReason },
    );
    res.json(out);
  },
);

assignmentsRouter.delete(
  "/:assignmentId",
  authMiddleware,
  requireRoles("ADMIN", "MANAGER"),
  async (req: AuthedRequest, res) => {
    const actor = req.user;
    if (!actor) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const assignmentId = singleParam(req.params["assignmentId"]);
    if (!assignmentId) {
      res.status(400).json({ error: "Missing assignment id" });
      return;
    }
    const emergencyOverrideReason =
      typeof req.query["emergencyOverrideReason"] === "string" ? req.query["emergencyOverrideReason"] : undefined;
    const out = await removeAssignment(assignmentId, actor, { emergencyOverrideReason });
    if (!out.ok) {
      if (out.reason === "NOT_FOUND") {
        res.status(404).json({ error: "Assignment not found" });
        return;
      }
      if (out.reason === "PAST_CUTOFF") {
        res.status(403).json({
          error:
            "This schedule is locked within the edit cutoff before this shift. For urgent changes, pass emergencyOverrideReason as a query parameter (min. 10 characters), use Notifications (coverage actions), or ask an administrator.",
        });
        return;
      }
      res.status(403).json({ error: "Forbidden for this assignment" });
      return;
    }
    res.status(204).send();
  },
);
