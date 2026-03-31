import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "../auth/jwt.js";
import type { UserRole } from "@shiftsync/shared";

export type AuthedRequest = Request & {
  user?: { id: string; email: string; role: UserRole };
};

export function authMiddleware(req: AuthedRequest, res: Response, next: NextFunction): void {
  const h = req.headers.authorization;
  const token = h?.startsWith("Bearer ") ? h.slice(7) : undefined;
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const p = verifyToken(token);
    req.user = { id: p.sub, email: p.email, role: p.role };
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
