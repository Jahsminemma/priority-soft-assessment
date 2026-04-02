import { z } from "zod";
import {
  AssignmentCommitRequestSchema,
  AssignmentPreviewRequestSchema,
  AvailabilityExceptionBatchInputSchema,
  AvailabilityExceptionInputSchema,
  CreateCoverageRequestSchema,
  ManagerCoverageQueueSchema,
  CreateInviteRequestSchema,
  CreateInviteResponseSchema,
  StaffLocationsPatchRequestSchema,
  TeamListResponseSchema,
  LoginRequestSchema,
  LoginResponseSchema,
  LocationSummarySchema,
  NotificationDtoSchema,
  RegisterCompleteRequestSchema,
  RegisterVerifyResponseSchema,
  ReplaceAvailabilityRulesSchema,
  ShiftDtoSchema,
  CreateShiftRequestSchema,
  UpdateShiftRequestSchema,
  type AvailabilityExceptionBatchInput,
  type AvailabilityExceptionInput,
  type CreateInviteRequest,
  type StaffLocationsPatchRequest,
  type TeamListResponse,
  type LoginResponse,
  type RegisterVerifyResponse,
  type ReplaceAvailabilityRules,
  type ShiftDto,
  type LocationSummary,
  type NotificationDto,
  type CreateCoverageRequest,
  type ManagerCoverageQueueItem,
  type NotificationPrefs,
  normalizeIsoWeekKey,
  WeekScheduleStateResponseSchema,
  EMERGENCY_OVERRIDE_MIN_LEN,
} from "@shiftsync/shared";

const base = import.meta.env.VITE_API_URL ?? "";

async function parseJson<T>(res: Response, schema: { parse: (data: unknown) => T }): Promise<T> {
  const data: unknown = await res.json();
  return schema.parse(data);
}

const SkillOptionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
});

export async function login(email: string, password: string): Promise<LoginResponse> {
  const body = LoginRequestSchema.parse({ email, password });
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Login failed");
  return parseJson(res, LoginResponseSchema);
}

async function readApiError(res: Response, fallback: string): Promise<string> {
  const j: unknown = await res.json().catch(() => ({}));
  if (typeof j === "object" && j !== null && "error" in j && typeof (j as { error: unknown }).error === "string") {
    return (j as { error: string }).error;
  }
  return fallback;
}

export async function createInvite(
  token: string,
  body: CreateInviteRequest,
): Promise<{ token: string; expiresAt: string }> {
  const res = await fetch(`${base}/api/admin/invites`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(CreateInviteRequestSchema.parse(body)),
  });
  if (!res.ok) throw new Error(await readApiError(res, "Could not create invite."));
  return parseJson(res, CreateInviteResponseSchema);
}

export async function fetchTeam(token: string): Promise<TeamListResponse> {
  const res = await fetch(`${base}/api/admin/team`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await readApiError(res, "Could not load team."));
  return parseJson(res, TeamListResponseSchema);
}

export async function updateStaffLocations(
  token: string,
  staffUserId: string,
  body: StaffLocationsPatchRequest,
): Promise<void> {
  const res = await fetch(`${base}/api/admin/staff/${encodeURIComponent(staffUserId)}/locations`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(StaffLocationsPatchRequestSchema.parse(body)),
  });
  if (!res.ok) throw new Error(await readApiError(res, "Could not update locations."));
}

export async function verifyRegisterToken(inviteToken: string): Promise<RegisterVerifyResponse> {
  const q = new URLSearchParams({ token: inviteToken });
  const res = await fetch(`${base}/api/register/verify?${q.toString()}`);
  if (!res.ok) throw new Error(await readApiError(res, "Invalid or expired invite."));
  return parseJson(res, RegisterVerifyResponseSchema);
}

export async function completeRegister(inviteToken: string, password: string): Promise<void> {
  const res = await fetch(`${base}/api/register/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(RegisterCompleteRequestSchema.parse({ token: inviteToken, password })),
  });
  if (!res.ok) throw new Error(await readApiError(res, "Could not complete registration."));
}

export async function fetchRosterCandidates(
  token: string,
  locationId: string,
  skillId: string,
): Promise<Array<{ id: string; name: string }>> {
  const q = new URLSearchParams({ skillId });
  const res = await fetch(
    `${base}/api/locations/${encodeURIComponent(locationId)}/roster-candidates?${q.toString()}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!res.ok) throw new Error("Roster candidates failed");
  const data: unknown = await res.json();
  return z.array(z.object({ id: z.string().uuid(), name: z.string() })).parse(data);
}

export async function fetchLocations(token: string): Promise<LocationSummary[]> {
  const res = await fetch(`${base}/api/locations`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Locations failed");
  const data: unknown = await res.json();
  return z.array(LocationSummarySchema).parse(data);
}

export async function fetchSkills(token: string): Promise<Array<{ id: string; name: string }>> {
  const res = await fetch(`${base}/api/skills`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Skills failed");
  const data: unknown = await res.json();
  return z.array(SkillOptionSchema).parse(data);
}

export async function fetchShifts(
  token: string,
  locationId: string,
  weekKey: string,
  signal?: AbortSignal,
): Promise<ShiftDto[]> {
  const wk = normalizeIsoWeekKey(weekKey);
  const q = new URLSearchParams({ locationId, weekKey: wk });
  const res = await fetch(`${base}/api/shifts?${q.toString()}`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}` },
    ...(signal !== undefined ? { signal } : {}),
  });
  if (!res.ok) throw new Error("Shifts failed");
  const data: unknown = await res.json();
  return z.array(ShiftDtoSchema).parse(data);
}

export async function fetchShiftsStaff(token: string, weekKey: string, signal?: AbortSignal): Promise<ShiftDto[]> {
  const wk = normalizeIsoWeekKey(weekKey);
  const q = new URLSearchParams({ weekKey: wk });
  const res = await fetch(`${base}/api/shifts?${q.toString()}`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}` },
    ...(signal !== undefined ? { signal } : {}),
  });
  if (!res.ok) throw new Error("Shifts failed");
  const data: unknown = await res.json();
  // Defensive client-side guard: staff views should never surface draft shifts.
  return z.array(ShiftDtoSchema).parse(data).filter((s) => s.status === "PUBLISHED");
}

export async function fetchShiftById(token: string, shiftId: string, signal?: AbortSignal): Promise<ShiftDto> {
  const res = await fetch(`${base}/api/shifts/${shiftId}`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}` },
    ...(signal !== undefined ? { signal } : {}),
  });
  if (!res.ok) throw new Error("Shift not found");
  const data: unknown = await res.json();
  return ShiftDtoSchema.parse(data);
}

export async function fetchShiftAssignments(
  token: string,
  shiftId: string,
): Promise<Array<{ assignmentId: string; staffUserId: string; staffName: string; staffEmail: string }>> {
  const res = await fetch(`${base}/api/shifts/${shiftId}/assignments`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Assignments failed");
  const data: unknown = await res.json();
  return z
    .array(
      z.object({
        assignmentId: z.string().uuid(),
        staffUserId: z.string().uuid(),
        staffName: z.string(),
        staffEmail: z.string(),
      }),
    )
    .parse(data);
}

const SwapCandidateRowSchema = z.object({
  staffUserId: z.string().uuid(),
  staffName: z.string(),
  secondShiftId: z.string().uuid(),
  theirShiftSkillName: z.string(),
  theirShiftStartAtUtc: z.string(),
  theirShiftEndAtUtc: z.string(),
  theirShiftLocationName: z.string(),
  theirShiftLocationTzIana: z.string(),
});

const SwapCandidatesResponseSchema = z.object({
  candidates: z.array(SwapCandidateRowSchema),
  hasPendingSwapRequest: z.boolean(),
  pendingSwapRequestId: z.string().uuid().nullable(),
  locationTzIana: z.string(),
});

export type SwapCandidatesPayload = z.infer<typeof SwapCandidatesResponseSchema>;

export async function fetchSwapCandidates(
  token: string,
  shiftId: string,
  signal?: AbortSignal,
): Promise<SwapCandidatesPayload> {
  const res = await fetch(`${base}/api/shifts/${shiftId}/swap-candidates`, {
    headers: { Authorization: `Bearer ${token}` },
    ...(signal !== undefined ? { signal } : {}),
  });
  if (!res.ok) {
    const err: unknown = await res.json().catch(() => ({}));
    throw new Error(
      typeof err === "object" && err !== null && "error" in err
        ? String((err as { error: unknown }).error)
        : "Could not load swap options",
    );
  }
  const data: unknown = await res.json();
  return SwapCandidatesResponseSchema.parse(data);
}

export async function publishWeek(
  token: string,
  body: { locationId: string; weekKey: string; cutoffHours?: number },
): Promise<{ weekKey: string; status: string }> {
  const payload = { ...body, weekKey: normalizeIsoWeekKey(body.weekKey) };
  const res = await fetch(`${base}/api/schedule/publish`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Publish failed");
  return (await res.json()) as { weekKey: string; status: string };
}

export async function unpublishWeek(
  token: string,
  body: { locationId: string; weekKey: string; emergencyOverrideReason?: string },
): Promise<{ weekKey: string; status: string }> {
  const payload = { ...body, weekKey: normalizeIsoWeekKey(body.weekKey) };
  const res = await fetch(`${base}/api/schedule/unpublish`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await readApiError(res, "Unpublish failed"));
  return (await res.json()) as { weekKey: string; status: string };
}

export async function fetchWeekScheduleState(
  token: string,
  locationId: string,
  weekKey: string,
): Promise<z.infer<typeof WeekScheduleStateResponseSchema>> {
  const params = new URLSearchParams({
    locationId,
    weekKey: normalizeIsoWeekKey(weekKey),
  });
  const res = await fetch(`${base}/api/schedule/week-state?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await readApiError(res, "Could not load schedule week state."));
  const data: unknown = await res.json();
  return WeekScheduleStateResponseSchema.parse(data);
}

export async function fetchNotifications(token: string): Promise<NotificationDto[]> {
  const res = await fetch(`${base}/api/notifications`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Notifications failed");
  const data: unknown = await res.json();
  return z.array(NotificationDtoSchema).parse(data);
}

export async function markNotificationReadApi(token: string, id: string): Promise<void> {
  const res = await fetch(`${base}/api/notifications/${id}/read`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Mark read failed");
}

export async function createShift(
  token: string,
  input: z.infer<typeof CreateShiftRequestSchema>,
): Promise<ShiftDto> {
  const body = CreateShiftRequestSchema.parse(input);
  const res = await fetch(`${base}/api/shifts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err: unknown = await res.json().catch(() => ({}));
    throw new Error(
      typeof err === "object" && err !== null && "error" in err
        ? String((err as { error: unknown }).error)
        : "Create shift failed",
    );
  }
  return parseJson(res, ShiftDtoSchema);
}

export async function updateShift(
  token: string,
  shiftId: string,
  input: z.infer<typeof UpdateShiftRequestSchema>,
): Promise<ShiftDto> {
  const body = UpdateShiftRequestSchema.parse(input);
  const res = await fetch(`${base}/api/shifts/${encodeURIComponent(shiftId)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readApiError(res, "Update shift failed"));
  return parseJson(res, ShiftDtoSchema);
}

export async function deleteShift(token: string, shiftId: string, emergencyOverrideReason?: string): Promise<void> {
  const q =
    emergencyOverrideReason !== undefined && emergencyOverrideReason !== ""
      ? `?${new URLSearchParams({ emergencyOverrideReason }).toString()}`
      : "";
  const res = await fetch(`${base}/api/shifts/${encodeURIComponent(shiftId)}${q}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err: unknown = await res.json().catch(() => ({}));
    throw new Error(
      typeof err === "object" && err !== null && "error" in err
        ? String((err as { error: unknown }).error)
        : "Delete shift failed",
    );
  }
}

export async function previewAssignment(
  token: string,
  shiftId: string,
  staffUserId: string,
  emergencyOverrideReason?: string,
): Promise<unknown> {
  const em = emergencyOverrideReason?.trim();
  const body = AssignmentPreviewRequestSchema.parse({
    shiftId,
    staffUserId,
    ...(em !== undefined && em.length >= EMERGENCY_OVERRIDE_MIN_LEN ? { emergencyOverrideReason: em } : {}),
  });
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
  input: {
    shiftId: string;
    staffUserId: string;
    idempotencyKey: string;
    seventhDayOverrideReason?: string;
    emergencyOverrideReason?: string;
  },
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

export async function deleteAssignment(
  token: string,
  assignmentId: string,
  emergencyOverrideReason?: string,
): Promise<void> {
  const q =
    emergencyOverrideReason !== undefined && emergencyOverrideReason !== ""
      ? `?${new URLSearchParams({ emergencyOverrideReason }).toString()}`
      : "";
  const res = await fetch(`${base}/api/assignments/${encodeURIComponent(assignmentId)}${q}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await readApiError(res, "Could not remove assignment."));
}

export async function createCoverageRequest(
  token: string,
  input: CreateCoverageRequest,
): Promise<{ id: string }> {
  const body = CreateCoverageRequestSchema.parse(input);
  const res = await fetch(`${base}/api/coverage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err: unknown = await res.json().catch(() => ({}));
    throw new Error(
      typeof err === "object" && err !== null && "error" in err
        ? String((err as { error: unknown }).error)
        : "Coverage request failed",
    );
  }
  return (await res.json()) as { id: string };
}

export async function acceptCoverageRequest(token: string, requestId: string): Promise<void> {
  const res = await fetch(`${base}/api/coverage/${requestId}/accept`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err: unknown = await res.json().catch(() => ({}));
    throw new Error(
      typeof err === "object" && err !== null && "error" in err
        ? String((err as { error: unknown }).error)
        : "Accept failed",
    );
  }
}

export async function approveCoverageRequest(token: string, requestId: string): Promise<void> {
  const res = await fetch(`${base}/api/coverage/${requestId}/approve`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err: unknown = await res.json().catch(() => ({}));
    throw new Error(
      typeof err === "object" && err !== null && "error" in err
        ? String((err as { error: unknown }).error)
        : "Approve failed",
    );
  }
}

export async function cancelCoverageRequest(token: string, requestId: string): Promise<void> {
  const res = await fetch(`${base}/api/coverage/${requestId}/cancel`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Cancel failed");
}

export async function declineCoverageRequest(token: string, requestId: string): Promise<void> {
  const res = await fetch(`${base}/api/coverage/${requestId}/decline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err: unknown = await res.json().catch(() => ({}));
    throw new Error(
      typeof err === "object" && err !== null && "error" in err
        ? String((err as { error: unknown }).error)
        : "Decline failed",
    );
  }
}

export async function fetchManagerCoverageQueue(token: string): Promise<ManagerCoverageQueueItem[]> {
  const res = await fetch(`${base}/api/coverage/manager-queue`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Could not load coverage queue.");
  return ManagerCoverageQueueSchema.parse(await res.json());
}

export async function clockIn(token: string, shiftId: string): Promise<{ sessionId: string }> {
  const res = await fetch(`${base}/api/clock/in`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ shiftId }),
  });
  if (!res.ok) {
    const err: unknown = await res.json().catch(() => ({}));
    throw new Error(
      typeof err === "object" && err !== null && "error" in err
        ? String((err as { error: unknown }).error)
        : "Clock in failed",
    );
  }
  return (await res.json()) as { sessionId: string };
}

export async function clockOut(token: string): Promise<{ sessionId: string }> {
  const res = await fetch(`${base}/api/clock/out`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err: unknown = await res.json().catch(() => ({}));
    throw new Error(
      typeof err === "object" && err !== null && "error" in err
        ? String((err as { error: unknown }).error)
        : "Clock out failed",
    );
  }
  return (await res.json()) as { sessionId: string };
}

const OnDutyRowSchema = z.object({
  sessionId: z.string().uuid(),
  staffUserId: z.string().uuid(),
  staffName: z.string(),
  shiftId: z.string().uuid().nullable(),
  clockInAtUtc: z.string(),
  shiftStartAtUtc: z.string().nullable(),
  shiftEndAtUtc: z.string().nullable(),
});

export async function fetchOnDutyForLocation(token: string, locationId: string): Promise<z.infer<typeof OnDutyRowSchema>[]> {
  const res = await fetch(`${base}/api/locations/${locationId}/on-duty`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("On-duty failed");
  const data: unknown = await res.json();
  return z.array(OnDutyRowSchema).parse(data);
}

const FairnessRowSchema = z.object({
  staffUserId: z.string().uuid(),
  name: z.string(),
  scheduledMinutes: z.number(),
  scheduledHours: z.number(),
  shiftCount: z.number(),
  premiumShiftCount: z.number(),
  desiredHoursWeekly: z.number().nullable(),
  premiumDeltaVsEqualShare: z.number(),
});

const OvertimeRowSchema = z.object({
  staffUserId: z.string().uuid(),
  name: z.string(),
  weeklyMinutes: z.number(),
  weeklyHours: z.number(),
  warnings: z.array(z.string()),
});

export async function fetchFairnessReport(
  token: string,
  locationId: string | "all",
  weekKey: string,
): Promise<z.infer<typeof FairnessRowSchema>[]> {
  const q = new URLSearchParams({ locationId, weekKey: normalizeIsoWeekKey(weekKey) });
  const res = await fetch(`${base}/api/analytics/fairness?${q}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Fairness report failed");
  const data: unknown = await res.json();
  return z.array(FairnessRowSchema).parse(data);
}

export async function fetchOvertimeWeekReport(
  token: string,
  locationId: string | "all",
  weekKey: string,
): Promise<z.infer<typeof OvertimeRowSchema>[]> {
  const q = new URLSearchParams({ locationId, weekKey: normalizeIsoWeekKey(weekKey) });
  const res = await fetch(`${base}/api/analytics/overtime/week?${q}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Overtime report failed");
  const data: unknown = await res.json();
  return z.array(OvertimeRowSchema).parse(data);
}

export async function getNotificationPrefs(token: string): Promise<NotificationPrefs> {
  const res = await fetch(`${base}/api/me/notification-prefs`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Prefs failed");
  return (await res.json()) as NotificationPrefs;
}

export async function patchNotificationPrefs(token: string, prefs: NotificationPrefs): Promise<NotificationPrefs> {
  const res = await fetch(`${base}/api/me/notification-prefs`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(prefs),
  });
  if (!res.ok) throw new Error("Update prefs failed");
  return (await res.json()) as NotificationPrefs;
}

const MyAvailabilityRuleRowSchema = z.object({
  id: z.string().uuid(),
  dayOfWeek: z.number().int().min(0).max(6),
  startLocalTime: z.string(),
  endLocalTime: z.string(),
});

const MyAvailabilityExceptionRowSchema = z.object({
  id: z.string().uuid(),
  startAtUtc: z.string(),
  endAtUtc: z.string(),
  type: z.enum(["UNAVAILABLE", "AVAILABLE_OVERRIDE"]),
  tzIana: z.string().nullable().optional(),
});

const MyAvailabilityResponseSchema = z.object({
  rules: z.array(MyAvailabilityRuleRowSchema),
  exceptions: z.array(MyAvailabilityExceptionRowSchema),
});

export type MyAvailability = z.infer<typeof MyAvailabilityResponseSchema>;

export async function fetchMyAvailability(token: string): Promise<MyAvailability> {
  const res = await fetch(`${base}/api/me/availability`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Could not load availability.");
  const data: unknown = await res.json();
  return MyAvailabilityResponseSchema.parse(data);
}

export async function replaceMyAvailabilityRules(token: string, body: ReplaceAvailabilityRules): Promise<void> {
  const res = await fetch(`${base}/api/me/availability/rules`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(ReplaceAvailabilityRulesSchema.parse(body)),
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, "Could not save weekly availability."));
  }
}

export async function addMyAvailabilityException(
  token: string,
  input: AvailabilityExceptionInput,
): Promise<{ id: string }> {
  const res = await fetch(`${base}/api/me/availability/exceptions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(AvailabilityExceptionInputSchema.parse(input)),
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, "Could not add exception."));
  }
  const data: unknown = await res.json();
  return z.object({ id: z.string().uuid() }).parse(data);
}

export async function addMyAvailabilityExceptionsBatch(
  token: string,
  input: AvailabilityExceptionBatchInput,
): Promise<{ ids: string[] }> {
  const res = await fetch(`${base}/api/me/availability/exceptions/batch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(AvailabilityExceptionBatchInputSchema.parse(input)),
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, "Could not add exceptions."));
  }
  const data: unknown = await res.json();
  return z.object({ ids: z.array(z.string().uuid()) }).parse(data);
}

export async function deleteMyAvailabilityException(token: string, exceptionId: string): Promise<void> {
  const res = await fetch(`${base}/api/me/availability/exceptions/${encodeURIComponent(exceptionId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await readApiError(res, "Could not remove exception."));
}
