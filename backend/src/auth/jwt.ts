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
  const verifyToken = jwt.verify(token, JWT_SECRET);
  if (typeof verifyToken !== "object" || verifyToken === null) throw new Error("Invalid token");
  const decodedToken = verifyToken as Record<string, unknown>;
  if (
    typeof decodedToken["sub"] !== "string" ||
    typeof decodedToken["email"] !== "string" ||
    typeof decodedToken["role"] !== "string"
  ) {
    throw new Error("Invalid token payload");
  }
  return {
    sub: decodedToken["sub"],
    email: decodedToken["email"],
    role: decodedToken["role"] as UserRole,
  };
}
