export function roleLabel(role: string | undefined): string {
  if (role === "ADMIN") return "Admin";
  if (role === "MANAGER") return "Manager";
  if (role === "STAFF") return "Staff";
  return role ?? "";
}

export function userInitial(name: string | undefined): string {
  const t = name?.trim();
  if (!t) return "?";
  return t[0]!.toUpperCase();
}
