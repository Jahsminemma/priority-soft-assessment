import jwt, { type SignOptions } from "jsonwebtoken";
import type { UserRole } from "@shiftsync/shared";

const JWT_SECRET = process.env["JWT_SECRET"] ?? "dev-secret-change-me";

export type JwtPayload = {
  sub: string;
  email: string;
  role: UserRole;
};

export function signToken(payload: JwtPayload, expiresIn: SignOptions["expiresIn"] = "7d"): string {
  const options: SignOptions = { expiresIn };
  return jwt.sign(payload, JWT_SECRET, options);
}

export function verifyToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, JWT_SECRET);
  if (typeof decoded !== "object" || decoded === null) throw new Error("Invalid token");
  const o = decoded as Record<string, unknown>;
  if (
    typeof o["sub"] !== "string" ||
    typeof o["email"] !== "string" ||
    typeof o["role"] !== "string"
  ) {
    throw new Error("Invalid token payload");
  }
  return {
    sub: o["sub"],
    email: o["email"],
    role: o["role"] as UserRole,
  };
}
