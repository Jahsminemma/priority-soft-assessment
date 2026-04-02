import { Router } from "express";
import { NotificationDtoSchema } from "@shiftsync/shared";
import { listNotificationsForUser, markNotificationRead } from "../../application/notifications/index.js";
import { authMiddleware, type AuthedRequest } from "../middleware/index.js";
import { singleParam } from "../paramId.js";
import { prisma } from "../../infrastructure/persistence/index.js";

export const notificationsRouter = Router();

function requestIdFromPayload(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const v = (payload as Record<string, unknown>)["requestId"];
  return typeof v === "string" && v.trim() ? v : null;
}

notificationsRouter.get("/", authMiddleware, async (req: AuthedRequest, res) => {
  const uid = req.user?.id;
  if (!uid) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const rows = await listNotificationsForUser(uid);

  // Attach current coverage request status so the UI can hide stale action buttons after refresh.
  const requestIds = rows.map((r) => requestIdFromPayload(r.payload)).filter((x): x is string => Boolean(x));
  const byRequestId =
    requestIds.length === 0
      ? new Map<string, { status: string; type: string }>()
      : new Map(
          (
            await prisma.coverageRequest.findMany({
              where: { id: { in: [...new Set(requestIds)] } },
              select: { id: true, status: true, type: true },
            })
          ).map((cr) => [cr.id, { status: cr.status, type: cr.type }]),
        );

  res.json(
    rows.map((r) =>
      NotificationDtoSchema.parse({
        id: r.id,
        type: r.type,
        payload: (() => {
          const rid = requestIdFromPayload(r.payload);
          if (!rid) return r.payload;
          const info = byRequestId.get(rid);
          if (!info) return r.payload;
          if (typeof r.payload !== "object" || r.payload === null || Array.isArray(r.payload)) return r.payload;
          return { ...(r.payload as Record<string, unknown>), requestStatus: info.status, requestType: info.type };
        })(),
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
