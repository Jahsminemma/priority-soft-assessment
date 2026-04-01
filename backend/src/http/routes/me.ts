import { Router } from "express";
import {
  AvailabilityExceptionInputSchema,
  NotificationPrefsSchema,
  ReplaceAvailabilityRulesSchema,
} from "@shiftsync/shared";
import {
  addMyAvailabilityException,
  deleteMyAvailabilityException,
  getMyAvailability,
  getMyNotificationPrefs,
  patchMyNotificationPrefs,
  replaceMyAvailabilityRules,
} from "../../application/me/index.js";
import { authMiddleware, requireRoles, type AuthedRequest } from "../middleware/index.js";
import { singleParam } from "../paramId.js";

export const meRouter = Router();

meRouter.get("/availability", authMiddleware, requireRoles("STAFF"), async (req: AuthedRequest, res) => {
  const uid = req.user?.id;
  if (!uid) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const data = await getMyAvailability(uid);
  res.json({
    rules: data.rules.map((r) => ({
      id: r.id,
      dayOfWeek: r.dayOfWeek,
      startLocalTime: r.startLocalTime,
      endLocalTime: r.endLocalTime,
    })),
    exceptions: data.exceptions.map((e) => ({
      id: e.id,
      startAtUtc: e.startAtUtc.toISOString(),
      endAtUtc: e.endAtUtc.toISOString(),
      type: e.type,
    })),
  });
});

meRouter.put("/availability/rules", authMiddleware, requireRoles("STAFF"), async (req: AuthedRequest, res) => {
  const uid = req.user?.id;
  if (!uid) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = ReplaceAvailabilityRulesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  await replaceMyAvailabilityRules(uid, parsed.data.rules);
  res.json({ ok: true });
});

meRouter.post("/availability/exceptions", authMiddleware, requireRoles("STAFF"), async (req: AuthedRequest, res) => {
  const uid = req.user?.id;
  if (!uid) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = AvailabilityExceptionInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const out = await addMyAvailabilityException(uid, parsed.data);
    res.status(201).json(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "INVALID_RANGE") {
      res.status(400).json({ error: "endAtUtc must be after startAtUtc" });
      return;
    }
    throw e;
  }
});

meRouter.delete(
  "/availability/exceptions/:id",
  authMiddleware,
  requireRoles("STAFF"),
  async (req: AuthedRequest, res) => {
    const uid = req.user?.id;
    if (!uid) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const id = singleParam(req.params["id"]);
    if (!id) {
      res.status(400).json({ error: "Missing id" });
      return;
    }
    const ok = await deleteMyAvailabilityException(uid, id);
    if (!ok) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({ ok: true });
  },
);

meRouter.get("/notification-prefs", authMiddleware, async (req: AuthedRequest, res) => {
  const uid = req.user?.id;
  if (!uid) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const prefs = await getMyNotificationPrefs(uid);
  res.json(prefs);
});

meRouter.patch("/notification-prefs", authMiddleware, async (req: AuthedRequest, res) => {
  const uid = req.user?.id;
  if (!uid) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = NotificationPrefsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const next = await patchMyNotificationPrefs(uid, parsed.data);
  res.json(next);
});
