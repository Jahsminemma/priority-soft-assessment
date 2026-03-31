import type { Request, Response, NextFunction } from "express";
import type { UserRole } from "@shiftsync/shared";
import { prisma } from "../../infrastructure/persistence/index.js";
import { verifyToken, type AuthedUser } from "../../security/index.js";

export type AuthedRequest = Request & {
  user?: AuthedUser;
};

export async function authMiddleware(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authorizationHeader = req.headers.authorization;
  const token = authorizationHeader?.startsWith("Bearer ") ? authorizationHeader.slice(7) : undefined;

  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const payload = verifyToken(token);
    let managerLocationIds: string[] = [];
    if (payload.role === "MANAGER") {
      const rows = await prisma.managerLocation.findMany({
        where: { userId: payload.sub },
        select: { locationId: true },
      });
      managerLocationIds = rows.map((r) => r.locationId);
    }
    req.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      managerLocationIds,
    };
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

export function requireRoles(...roles: UserRole[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
}
