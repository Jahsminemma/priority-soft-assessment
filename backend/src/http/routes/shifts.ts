import { Router } from "express";
import {
  CreateShiftRequestSchema,
  ListShiftsQuerySchema,
  ListShiftsStaffQuerySchema,
  ShiftDtoSchema,
  UpdateShiftRequestSchema,
} from "@shiftsync/shared";
import { listSwapCandidatesForAssignedStaff } from "../../application/assignments/index.js";
import {
  createShift,
  deleteShift,
  getShiftForViewer,
  listAssignmentsForShift,
  listPublishedShiftsForStaff,
  listShiftsByLocationWeek,
  updateShift,
} from "../../application/shifts/index.js";
import { authMiddleware, requireRoles, type AuthedRequest } from "../middleware/index.js";
import { singleParam } from "../paramId.js";

export const shiftsRouter = Router();

shiftsRouter.get(
  "/:id/assignments",
  authMiddleware,
  requireRoles("ADMIN", "MANAGER", "STAFF"),
  async (req: AuthedRequest, res) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const shiftId = singleParam(req.params["id"]);
    if (!shiftId) {
      res.status(400).json({ error: "Missing shift id" });
      return;
    }
    const out = await listAssignmentsForShift(user, shiftId);
    if (!out.ok) {
      res.status(out.reason === "NOT_FOUND" ? 404 : 403).json({ error: out.reason });
      return;
    }
    res.json(out.rows);
  },
);

shiftsRouter.get(
  "/:id/swap-candidates",
  authMiddleware,
  requireRoles("STAFF"),
  async (req: AuthedRequest, res) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const shiftId = singleParam(req.params["id"]);
    if (!shiftId) {
      res.status(400).json({ error: "Missing shift id" });
      return;
    }
    const out = await listSwapCandidatesForAssignedStaff(user, shiftId);
    if (!out.ok) {
      const status = out.reason === "NOT_FOUND" ? 404 : 403;
      res.status(status).json({ error: out.reason });
      return;
    }
    res.json({
      candidates: out.candidates,
      hasPendingSwapRequest: out.hasPendingSwapRequest,
      locationTzIana: out.locationTzIana,
    });
  },
);

shiftsRouter.get("/:id", authMiddleware, async (req: AuthedRequest, res) => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const shiftId = singleParam(req.params["id"]);
  if (!shiftId) {
    res.status(400).json({ error: "Missing shift id" });
    return;
  }
  const shift = await getShiftForViewer(user, shiftId);
  if (!shift) {
    res.status(404).json({ error: "NOT_FOUND" });
    return;
  }
  res.json(ShiftDtoSchema.parse(shift));
});

shiftsRouter.get("/", authMiddleware, async (req: AuthedRequest, res) => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (user.role === "STAFF") {
    const parsed = ListShiftsStaffQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const rows = await listPublishedShiftsForStaff(user, parsed.data.weekKey);
    res.json(rows.map((s) => ShiftDtoSchema.parse(s)));
    return;
  }

  if (user.role !== "ADMIN" && user.role !== "MANAGER") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const parsed = ListShiftsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { locationId, weekKey } = parsed.data;
  const rows = await listShiftsByLocationWeek(user, locationId, weekKey);
  if (rows === null) {
    res.status(403).json({ error: "Forbidden for this location" });
    return;
  }
  res.json(rows.map((s) => ShiftDtoSchema.parse(s)));
});

shiftsRouter.post(
  "/",
  authMiddleware,
  requireRoles("ADMIN", "MANAGER"),
  async (req: AuthedRequest, res) => {
    const parsed = CreateShiftRequestSchema.safeParse(req.body);
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
      const created = await createShift(user, parsed.data);
      if (created === null) {
        res.status(403).json({ error: "Forbidden for this location" });
        return;
      }
      res.status(201).json(ShiftDtoSchema.parse(created));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "INVALID_RANGE") {
        res.status(400).json({ error: "endAtUtc must be after startAtUtc" });
        return;
      }
      if (msg === "LOCATION_NOT_FOUND" || msg === "SKILL_NOT_FOUND") {
        res.status(404).json({ error: msg });
        return;
      }
      if (msg === "WEEK_IN_PAST") {
        res.status(400).json({ error: "Schedule only for this week or a future week." });
        return;
      }
      if (msg === "SHIFT_START_IN_PAST") {
        res.status(400).json({ error: "Shift start date cannot be in the past." });
        return;
      }
      throw e;
    }
  },
);

shiftsRouter.delete(
  "/:id",
  authMiddleware,
  requireRoles("ADMIN", "MANAGER"),
  async (req: AuthedRequest, res) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const sid = singleParam(req.params["id"]);
    if (!sid) {
      res.status(400).json({ error: "Missing shift id" });
      return;
    }
    const emergencyOverrideReason =
      typeof req.query["emergencyOverrideReason"] === "string" ? req.query["emergencyOverrideReason"] : undefined;
    const out = await deleteShift(user, sid, { emergencyOverrideReason });
    if ("error" in out) {
      const status =
        out.error === "NOT_FOUND" ? 404 : out.error === "PAST_CUTOFF" ? 400 : 403;
      res.status(status).json({ error: out.error });
      return;
    }
    res.status(204).send();
  },
);

shiftsRouter.patch(
  "/:id",
  authMiddleware,
  requireRoles("ADMIN", "MANAGER"),
  async (req: AuthedRequest, res) => {
    const parsed = UpdateShiftRequestSchema.safeParse(req.body);
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
      const sid = singleParam(req.params["id"]);
      if (!sid) {
        res.status(400).json({ error: "Missing shift id" });
        return;
      }
      const out = await updateShift(user, sid, parsed.data);
      if ("error" in out) {
        const status =
          out.error === "NOT_FOUND" ? 404 : out.error === "PAST_CUTOFF" ? 400 : 403;
        res.status(status).json({ error: out.error });
        return;
      }
      res.json(ShiftDtoSchema.parse(out));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "INVALID_RANGE") {
        res.status(400).json({ error: "endAtUtc must be after startAtUtc" });
        return;
      }
      if (msg.startsWith("ASSIGNED_STAFF_CONSTRAINTS:")) {
        const parts = msg.split(":");
        const staffName = parts[1] ?? "assigned staff member";
        const reason = parts.slice(2).join(":") || "assignment constraints would be violated";
        res.status(400).json({
          error: `Cannot update shift because ${staffName} would violate assignment constraints: ${reason}`,
        });
        return;
      }
      throw e;
    }
  },
);
