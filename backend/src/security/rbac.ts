import type { UserRole } from "@shiftsync/shared";

export type AuthedUser = {
  id: string;
  email: string;
  role: UserRole;
  /** Set for MANAGER after DB load; empty for others. */
  managerLocationIds: string[];
};

export function canManageLocation(user: AuthedUser, locationId: string): boolean {
  if (user.role === "ADMIN") return true;
  if (user.role === "MANAGER") return user.managerLocationIds.includes(locationId);
  return false;
}
