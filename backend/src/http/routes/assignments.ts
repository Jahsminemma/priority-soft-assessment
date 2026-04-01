import { Router, type Response } from "express";
import {
  AssignmentCommitRequestSchema,
  AssignmentPreviewRequestSchema,
} from "@shiftsync/shared";
import { commitAssignment, previewAssignment } from "../../application/assignments/index.js";
import { prisma } from "../../infrastructure/persistence/index.js";
import { canManageLocation } from "../../security/index.js";
import { authMiddleware, requireRoles, type AuthedRequest } from "../middleware/index.js";

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

    if (!(await assertCanManageShift(req, parsed.data.shiftId, res))) return;

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
