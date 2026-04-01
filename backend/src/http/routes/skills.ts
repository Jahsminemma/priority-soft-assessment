import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../infrastructure/persistence/index.js";
import { authMiddleware, type AuthedRequest } from "../middleware/index.js";

const SkillOptionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
});

export const skillsRouter = Router();

skillsRouter.get("/", authMiddleware, async (_req: AuthedRequest, res) => {
  const skills = await prisma.skill.findMany({ orderBy: { name: "asc" } });
  const out = skills.map((s) => SkillOptionSchema.parse(s));
  res.json(out);
});
