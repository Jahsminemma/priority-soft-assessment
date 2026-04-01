import { Router } from "express";
import { NotificationDtoSchema } from "@shiftsync/shared";
import { listNotificationsForUser, markNotificationRead } from "../../application/notifications/index.js";
import { authMiddleware, type AuthedRequest } from "../middleware/index.js";
import { singleParam } from "../paramId.js";

export const notificationsRouter = Router();

notificationsRouter.get("/", authMiddleware, async (req: AuthedRequest, res) => {
  const uid = req.user?.id;
  if (!uid) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const rows = await listNotificationsForUser(uid);
  res.json(
    rows.map((r) =>
      NotificationDtoSchema.parse({
        id: r.id,
        type: r.type,
        payload: r.payload,
        readAt: r.readAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      }),
    ),
  );
});

notificationsRouter.patch("/:id/read", authMiddleware, async (req: AuthedRequest, res) => {
  const uid = req.user?.id;
  if (!uid) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const nid = singleParam(req.params["id"]);
  if (!nid) {
    res.status(400).json({ error: "Missing id" });
    return;
  }
  const ok = await markNotificationRead(uid, nid);
  if (!ok) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ ok: true });
});
