import { randomBytes, createHash } from "crypto";
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { CreateInviteRequestSchema } from "@shiftsync/shared";
import { prisma } from "../../infrastructure/persistence/index.js";
import { authMiddleware, requireRoles, type AuthedRequest } from "../middleware/index.js";

export const adminInvitesRouter = Router();

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

adminInvitesRouter.post(
  "/invites",
  authMiddleware,
  requireRoles("ADMIN"),
  async (req: AuthedRequest, res): Promise<void> => {
    try {
      const parsed = CreateInviteRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      const { email, name, role, desiredHoursWeekly, managerLocationIds } = parsed.data;
      const emailNorm = email.toLowerCase();

      const existingUser = await prisma.user.findUnique({ where: { email: emailNorm } });
      if (existingUser) {
        res.status(409).json({ error: "That email already has an account." });
        return;
      }

      const pending = await prisma.registrationInvite.findFirst({
        where: { email: emailNorm, consumedAt: null },
      });
      if (pending && pending.expiresAt > new Date()) {
        res.status(409).json({ error: "An invite is already pending for this email." });
        return;
      }
      if (pending) {
        await prisma.registrationInvite.delete({ where: { id: pending.id } });
      }

      if (role === "MANAGER" && managerLocationIds?.length) {
        const count = await prisma.location.count({ where: { id: { in: managerLocationIds } } });
        if (count !== managerLocationIds.length) {
          res.status(400).json({ error: "One or more locations are invalid." });
          return;
        }
      }

      const plainToken = randomBytes(32).toString("hex");
      const tokenHash = hashToken(plainToken);
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      await prisma.registrationInvite.create({
        data: {
          tokenHash,
          email: emailNorm,
          name,
          role,
          desiredHoursWeekly: role === "STAFF" ? desiredHoursWeekly ?? null : null,
          managerLocationIds:
            role === "MANAGER" ? (managerLocationIds ?? []) : Prisma.JsonNull,
          expiresAt,
          createdById: req.user!.id,
        },
      });

      res.json({
        token: plainToken,
        expiresAt: expiresAt.toISOString(),
      });
    } catch (err) {
      console.error("[admin/invites]", err);
      res.status(500).json({
        error:
          "Could not create invite. Ensure the database is migrated (npm run db:migrate from the repo root).",
      });
    }
  },
);
