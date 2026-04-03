import type { Prisma } from "@prisma/client";
import { prisma } from "../../infrastructure/persistence/index.js";
import { emitNotificationCreated } from "../../realtime/events.js";

function mergeEmailSimulatedDelivery(
  payload: Record<string, unknown>,
  email: string,
): Record<string, unknown> {
  const sentAt = new Date().toISOString();
  const prevDelivery = payload["delivery"];
  const base =
    typeof prevDelivery === "object" && prevDelivery !== null && !Array.isArray(prevDelivery)
      ? (prevDelivery as Record<string, unknown>)
      : {};
  return {
    ...payload,
    delivery: {
      ...base,
      channels: ["IN_APP", "EMAIL_SIMULATED"],
      emailSimulated: { to: email, at: sentAt },
    },
  };
}

export async function createNotification(
  userId: string,
  type: string,
  payload: Record<string, unknown>,
): Promise<{ id: string }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, notificationPrefs: true },
  });
  const prefs = (user?.notificationPrefs ?? {}) as Record<string, unknown>;
  const wantEmailSim = prefs.emailSimulated === true;

  const storedPayload =
    wantEmailSim && user?.email
      ? mergeEmailSimulatedDelivery({ ...payload }, user.email)
      : { ...payload };

  if (wantEmailSim && user?.email && process.env.NODE_ENV !== "production") {
    // Demo / evaluator visibility: no outbound SMTP in this stack.
    console.info(`[EMAIL_SIMULATED] type=${type} to=${user.email} body=${JSON.stringify(storedPayload)}`);
  }

  const n = await prisma.notification.create({
    data: { userId, type, payload: storedPayload as Prisma.InputJsonValue },
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
