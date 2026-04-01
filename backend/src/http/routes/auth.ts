import { Router } from "express";
import bcrypt from "bcryptjs";
import { LoginRequestSchema } from "@shiftsync/shared";
import { prisma } from "../../infrastructure/persistence/index.js";
import { signToken } from "../../security/index.js";
import { authMiddleware, type AuthedRequest } from "../middleware/index.js";

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  const parsed = LoginRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { email, password } = parsed.data;
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    include: { managerLocations: true },
  });
  if (!user) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  const token = signToken({
    sub: user.id,
    email: user.email,
    role: user.role,
  });
  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      managerLocationIds: user.managerLocations.map((m) => m.locationId),
    },
  });
});

authRouter.get("/me", authMiddleware, async (req: AuthedRequest, res) => {
  const u = req.user;
  if (!u) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: u.id },
    include: { managerLocations: true },
  });
  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    managerLocationIds: user.managerLocations.map((m) => m.locationId),
  });
});
