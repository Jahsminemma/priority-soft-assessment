import type { Server, Socket } from "socket.io";
import { z } from "zod";
import { prisma } from "../infrastructure/persistence/index.js";

async function allowedLocationIds(userId: string, role: string): Promise<Set<string>> {
  if (role === "ADMIN") {
    const rows = await prisma.location.findMany({ select: { id: true } });
    return new Set(rows.map((r) => r.id));
  }
  if (role === "MANAGER") {
    const rows = await prisma.managerLocation.findMany({
      where: { userId },
      select: { locationId: true },
    });
    return new Set(rows.map((r) => r.locationId));
  }
  const rows = await prisma.staffCertification.findMany({
    where: { userId },
    select: { locationId: true },
  });
  return new Set(rows.map((r) => r.locationId));
}

export function registerSocketConnectionHandlers(io: Server): void {
  io.on("connection", (socket: Socket) => {
    const userId = socket.data.userId as string;
    const role = socket.data.role as string;

    void socket.join(`user:${userId}`);
    socket.emit("connected", { userId });

    socket.on("subscribe:locations", async (raw: unknown, cb?: (r: unknown) => void) => {
      const parsed = z.array(z.string().uuid()).safeParse(raw);
      if (!parsed.success) {
        cb?.({ ok: false, error: "invalid_payload" });
        return;
      }
      const allowed = await allowedLocationIds(userId, role);
      const joined = parsed.data.filter((id) => allowed.has(id));
      for (const id of joined) {
        void socket.join(`location:${id}`);
      }
      cb?.({ ok: true, joined });
    });
  });
}
