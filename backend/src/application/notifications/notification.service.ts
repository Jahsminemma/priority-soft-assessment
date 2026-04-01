import type { Prisma } from "@prisma/client";
import { prisma } from "../../infrastructure/persistence/index.js";
import { emitNotificationCreated } from "../../realtime/events.js";

export async function createNotification(
  userId: string,
  type: string,
  payload: Record<string, unknown>,
): Promise<{ id: string }> {
  const n = await prisma.notification.create({
    data: { userId, type, payload: payload as Prisma.InputJsonValue },
  });
  emitNotificationCreated(userId, { notificationId: n.id, type });
  return { id: n.id };
}

export async function listNotificationsForUser(userId: string): Promise<
  Array<{
    id: string;
    type: string;
    payload: unknown;
    readAt: Date | null;
    createdAt: Date;
  }>
> {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export async function markNotificationRead(userId: string, notificationId: string): Promise<boolean> {
  const r = await prisma.notification.updateMany({
    where: { id: notificationId, userId },
    data: { readAt: new Date() },
  });
  return r.count > 0;
}
