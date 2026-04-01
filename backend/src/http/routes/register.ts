import { createHash } from "crypto";
import { Router } from "express";
import bcrypt from "bcryptjs";
import { RegisterCompleteRequestSchema, RegisterVerifyResponseSchema } from "@shiftsync/shared";
import { prisma } from "../../infrastructure/persistence/index.js";

export const registerRouter = Router();

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

registerRouter.get("/verify", async (req, res): Promise<void> => {
  try {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    if (!token || token.length < 32) {
      res.status(400).json({ error: "Missing or invalid token." });
      return;
    }

    const invite = await prisma.registrationInvite.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (!invite || invite.consumedAt) {
      res.status(404).json({ error: "Invite not found or already used." });
      return;
    }
    if (invite.expiresAt <= new Date()) {
      res.status(410).json({ error: "This invite has expired. Ask your administrator for a new link." });
      return;
    }

    const body = RegisterVerifyResponseSchema.parse({
      name: invite.name,
      email: invite.email,
      role: invite.role,
    });
    res.json(body);
  } catch (err) {
    console.error("[register/verify]", err);
    res.status(500).json({ error: "Could not verify invite." });
  }
});

registerRouter.post("/complete", async (req, res): Promise<void> => {
  try {
    const parsed = RegisterCompleteRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const { token, password } = parsed.data;

    const invite = await prisma.registrationInvite.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (!invite || invite.consumedAt) {
      res.status(404).json({ error: "Invite not found or already used." });
      return;
    }
    if (invite.expiresAt <= new Date()) {
      res.status(410).json({ error: "This invite has expired." });
      return;
    }

    const emailNorm = invite.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email: emailNorm } });
    if (existing) {
      res.status(409).json({ error: "This email is already registered." });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);

    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: emailNorm,
          passwordHash,
          name: invite.name,
          role: invite.role,
          desiredHoursWeekly: invite.desiredHoursWeekly,
          notificationPrefs: {},
        },
      });

      if (invite.role === "MANAGER") {
        const raw = invite.managerLocationIds;
        const ids = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
        if (ids.length) {
          await tx.managerLocation.createMany({
            data: ids.map((locationId) => ({ userId: user.id, locationId })),
            skipDuplicates: true,
          });
        }
      }

      if (invite.role === "STAFF") {
        const rawSkills = invite.staffSkillIds;
        const skillIds = Array.isArray(rawSkills) ? rawSkills.filter((x): x is string => typeof x === "string") : [];
        if (skillIds.length) {
          await tx.staffSkill.createMany({
            data: skillIds.map((skillId) => ({ userId: user.id, skillId })),
            skipDuplicates: true,
          });
        }
        const rawLocs = invite.staffLocationIds;
        const locIds = Array.isArray(rawLocs) ? rawLocs.filter((x): x is string => typeof x === "string") : [];
        if (locIds.length) {
          await tx.staffCertification.createMany({
            data: locIds.map((locationId) => ({ userId: user.id, locationId })),
            skipDuplicates: true,
          });
        }
      }

      await tx.registrationInvite.update({
        where: { id: invite.id },
        data: { consumedAt: new Date() },
      });
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("[register/complete]", err);
    res.status(500).json({ error: "Could not complete registration." });
  }
});
