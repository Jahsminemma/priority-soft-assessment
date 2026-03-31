import {
  AssignmentCommitRequestSchema,
  AssignmentPreviewRequestSchema,
  LoginRequestSchema,
  LoginResponseSchema,
} from "@shiftsync/shared";

const base = import.meta.env.VITE_API_URL ?? "";

async function parseJson<T>(res: Response, schema: { parse: (data: unknown) => T }): Promise<T> {
  const data: unknown = await res.json();
  return schema.parse(data);
}

export async function login(email: string, password: string): Promise<string> {
  const body = LoginRequestSchema.parse({ email, password });
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Login failed");
  const data = await parseJson(res, LoginResponseSchema);
  return data.token;
}

export async function previewAssignment(
  token: string,
  shiftId: string,
  staffUserId: string,
): Promise<unknown> {
  const body = AssignmentPreviewRequestSchema.parse({ shiftId, staffUserId });
  const res = await fetch(`${base}/api/assignments/preview`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Preview failed");
  return (await res.json()) as unknown;
}

export async function commitAssignment(
  token: string,
  input: { shiftId: string; staffUserId: string; idempotencyKey: string; seventhDayOverrideReason?: string },
): Promise<unknown> {
  const body = AssignmentCommitRequestSchema.parse(input);
  const res = await fetch(`${base}/api/assignments/commit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return (await res.json()) as unknown;
}
