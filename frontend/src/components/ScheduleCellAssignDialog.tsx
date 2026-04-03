import { useEffect, useMemo, useState } from "react";
import { useDebouncedValue } from "../hooks/useDebouncedValue.js";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { commitAssignment, deleteAssignment, previewAssignment } from "../api.js";
import { AssignmentAlternativesHint } from "./AssignmentAlternativesHint.js";
import { ConstraintAlert } from "./ConstraintAlert.js";
import { ConstraintViolationCards } from "./ConstraintViolationCards.js";
import {
  formatShiftTimeRangeShort,
  utcIsoToLocalYmd,
} from "../utils/scheduleTime.js";
import {
  AssignmentCommitResponseSchema,
  AssignmentPreviewResponseSchema,
  EMERGENCY_OVERRIDE_MIN_LEN,
  type AssignmentCommitResponse,
  type AssignmentPreviewResponse,
  type ShiftDto,
} from "@shiftsync/shared";
import type { ShiftAssignmentRow } from "../types/shiftAssignment.js";

type Props = {
  open: boolean;
  onClose: () => void;
  token: string;
  staffUserId: string;
  staffName: string;
  staffSkillIds: Set<string>;
  dayYmd: string;
  locationTz: string;
  shifts: ShiftDto[];
  assignmentsPerShift: Array<ShiftAssignmentRow[] | undefined>;
  skillNameById: Map<string, string>;
  staffRows?: Array<{ id: string; name: string; skillIds: Set<string> }>;
  /** Opens create-shift for this day (e.g. when there are no matching open shifts). */
  onAddShiftForDay?: (dayYmd: string) => void;
  /** Optional shift to preselect (used by quick-fill flow after a callout). */
  initialShiftId?: string;
  /** From GET /api/schedule/week-state — used for per-shift cutoff UI. */
  scheduleCutoff?: { cutoffHours: number; weekRowStatus: "NONE" | "DRAFT" | "PUBLISHED" } | null;
};

function formatUsd(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function fmtHoursFromMin(m: number): string {
  return `${(m / 60).toFixed(1)}h`;
}

function shiftPastCutoff(
  shift: ShiftDto,
  scheduleCutoff: { cutoffHours: number; weekRowStatus: "NONE" | "DRAFT" | "PUBLISHED" } | null | undefined,
): boolean {
  if (!scheduleCutoff || scheduleCutoff.weekRowStatus !== "PUBLISHED") return false;
  const ms = scheduleCutoff.cutoffHours * 60 * 60 * 1000;
  return Date.now() > new Date(shift.startAtUtc).getTime() - ms;
}

export function ScheduleCellAssignDialog({
  open,
  onClose,
  token,
  staffUserId,
  staffName,
  staffSkillIds,
  dayYmd,
  locationTz,
  shifts,
  assignmentsPerShift,
  skillNameById,
  staffRows,
  onAddShiftForDay,
  initialShiftId,
  scheduleCutoff = null,
}: Props): React.ReactElement | null {
  const queryClient = useQueryClient();
  const [shiftId, setShiftId] = useState<string>("");
  const [emergencyOverrideReason, setEmergencyOverrideReason] = useState("");
  const [seventhReason, setSeventhReason] = useState("");
  const [commitResult, setCommitResult] = useState<AssignmentCommitResponse | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const shiftIndexById = useMemo(() => new Map(shifts.map((s, i) => [s.id, i])), [shifts]);

  const eligibleShifts = useMemo(() => {
    return shifts.filter((s) => {
      if (utcIsoToLocalYmd(s.startAtUtc, locationTz) !== dayYmd) return false;
      if (!staffSkillIds.has(s.requiredSkillId)) return false;
      const idx = shiftIndexById.get(s.id);
      if (idx === undefined) return false;
      const rows = assignmentsPerShift[idx];
      const assigned = rows?.length ?? s.assignedCount ?? 0;
      if (assigned >= s.headcount) return false;
      const ids = new Set((rows ?? []).map((a) => a.staffUserId));
      if (ids.has(staffUserId)) return false;
      return true;
    });
  }, [shifts, dayYmd, locationTz, staffSkillIds, staffUserId, assignmentsPerShift, shiftIndexById]);

  const shiftsToday = useMemo(() => {
    return shifts.filter((s) => utcIsoToLocalYmd(s.startAtUtc, locationTz) === dayYmd);
  }, [shifts, dayYmd, locationTz]);

  const openShiftsToday = useMemo(() => {
    const out: ShiftDto[] = [];
    for (const s of shiftsToday) {
      const idx = shiftIndexById.get(s.id);
      if (idx === undefined) continue;
      const rows = assignmentsPerShift[idx] ?? [];
      const assigned = rows.length ?? s.assignedCount ?? 0;
      if (assigned < s.headcount) out.push(s);
    }
    out.sort((a, b) => a.startAtUtc.localeCompare(b.startAtUtc));
    return out;
  }, [shiftsToday, shiftIndexById, assignmentsPerShift]);

  const suggestedStaffNames = useMemo(() => {
    if (!staffRows?.length || openShiftsToday.length === 0) return [];
    const names: string[] = [];
    const taken = new Set<string>();

    for (const s of openShiftsToday) {
      const idx = shiftIndexById.get(s.id);
      const assignedIds = new Set((idx !== undefined ? (assignmentsPerShift[idx] ?? []) : []).map((a) => a.staffUserId));
      for (const staff of staffRows) {
        if (staff.id === staffUserId) continue;
        if (!staff.skillIds.has(s.requiredSkillId)) continue;
        if (assignedIds.has(staff.id)) continue;
        if (taken.has(staff.id)) continue;
        taken.add(staff.id);
        names.push(staff.name);
        if (names.length >= 3) return names;
      }
    }
    return names;
  }, [staffRows, openShiftsToday, assignmentsPerShift, shiftIndexById, staffUserId]);

  const existingAssignmentsToday = useMemo(() => {
    const out: Array<{ assignmentId: string; shift: ShiftDto }> = [];
    for (const s of shiftsToday) {
      const idx = shiftIndexById.get(s.id);
      if (idx === undefined) continue;
      const rows = assignmentsPerShift[idx] ?? [];
      for (const a of rows) {
        if (a.staffUserId === staffUserId) out.push({ assignmentId: a.assignmentId, shift: s });
      }
    }
    out.sort((a, b) => a.shift.startAtUtc.localeCompare(b.shift.startAtUtc));
    return out;
  }, [shiftsToday, shiftIndexById, assignmentsPerShift, staffUserId]);

  useEffect(() => {
    if (!open) return;
    setEmergencyOverrideReason("");
    setSeventhReason("");
    setCommitResult(null);
    setIdempotencyKey(crypto.randomUUID());
    setShiftId((prev) => {
      if (initialShiftId && eligibleShifts.some((s) => s.id === initialShiftId)) return initialShiftId;
      if (eligibleShifts.some((s) => s.id === prev)) return prev;
      return eligibleShifts[0]?.id ?? "";
    });
  }, [open, dayYmd, staffUserId, eligibleShifts, initialShiftId]);

  /** Avoid showing a stale “allowed” preview after staff availability (exceptions) changed while this dialog was closed. */
  useEffect(() => {
    if (!open) return;
    void queryClient.resetQueries({ queryKey: ["assignmentPreview"] });
  }, [open, queryClient]);

  const selectedShift = useMemo(() => shifts.find((s) => s.id === shiftId), [shifts, shiftId]);

  const showEmergencyField = useMemo(() => {
    if (!scheduleCutoff) return false;
    for (const { shift } of existingAssignmentsToday) {
      if (shiftPastCutoff(shift, scheduleCutoff)) return true;
    }
    if (selectedShift && shiftPastCutoff(selectedShift, scheduleCutoff)) return true;
    return false;
  }, [scheduleCutoff, existingAssignmentsToday, selectedShift]);

  const previewEnabled =
    open &&
    Boolean(shiftId) &&
    Boolean(staffUserId) &&
    eligibleShifts.some((s) => s.id === shiftId);

  /** Do not put raw `emergencyOverrideReason` / `seventhReason` in the query key — refetches every keystroke. */
  const debouncedEmergencyForPreview = useDebouncedValue(emergencyOverrideReason, 600);
  const debouncedSeventhForPreview = useDebouncedValue(seventhReason, 600);

  const previewQuery = useQuery({
    queryKey: ["assignmentPreview", token, shiftId, staffUserId, debouncedEmergencyForPreview, debouncedSeventhForPreview] as const,
    queryFn: async (): Promise<AssignmentPreviewResponse> => {
      const raw = await previewAssignment(
        token,
        shiftId,
        staffUserId,
        debouncedEmergencyForPreview,
        debouncedSeventhForPreview,
      );
      return AssignmentPreviewResponseSchema.parse(raw);
    },
    enabled: previewEnabled,
    staleTime: 0,
    placeholderData: keepPreviousData,
  });

  const preview = previewQuery.data ?? null;
  /** Keep override field visible for the whole flow: blocked → typing → preview allowed with override warning. */
  const showSeventhDayReasonField = useMemo(() => {
    const hard = preview?.hardViolations.some((v) => v.code === "WEEKLY_SEVENTH_DAY") ?? false;
    const overridden = preview?.warnings.some((v) => v.code === "WEEKLY_SEVENTH_DAY_OVERRIDE") ?? false;
    const hasDraft = seventhReason.trim().length > 0;
    return hard || overridden || hasDraft;
  }, [preview, seventhReason]);
  /** Only show full-page “checking” when there is no data yet — not on background refetches (avoids layout jump). */
  const previewLoadingInitial = previewEnabled && previewQuery.isPending && !previewQuery.isPlaceholderData;

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ["shifts"] });
    void queryClient.invalidateQueries({ queryKey: ["shiftAssignments"] });
    void queryClient.invalidateQueries({ queryKey: ["assignmentPreview"] });
    void queryClient.invalidateQueries({ queryKey: ["analytics", "overtimeCost"] });
  };

  const commitMut = useMutation({
    mutationFn: async () => {
      const trimmed = seventhReason.trim();
      const em = emergencyOverrideReason.trim();
      const raw = await commitAssignment(token, {
        shiftId,
        staffUserId,
        idempotencyKey,
        ...(trimmed ? { seventhDayOverrideReason: trimmed } : {}),
        ...(em.length >= EMERGENCY_OVERRIDE_MIN_LEN ? { emergencyOverrideReason: em } : {}),
      });
      return AssignmentCommitResponseSchema.parse(raw);
    },
    onSuccess: (data) => {
      setCommitResult(data);
      if (data.success) {
        invalidate();
        setIdempotencyKey(crypto.randomUUID());
        onClose();
      }
    },
  });

  const removeMut = useMutation({
    mutationFn: async ({ assignmentId, shift }: { assignmentId: string; shift: ShiftDto }) => {
      const locked = shiftPastCutoff(shift, scheduleCutoff ?? null);
      const em = emergencyOverrideReason.trim();
      if (locked && em.length < EMERGENCY_OVERRIDE_MIN_LEN) {
        throw new Error(
          `Enter an emergency reason (at least ${EMERGENCY_OVERRIDE_MIN_LEN} characters) to change this assignment.`,
        );
      }
      await deleteAssignment(token, assignmentId, locked ? em : undefined);
    },
    onSuccess: invalidate,
  });

  const commitNeedsEmergency =
    showEmergencyField &&
    selectedShift &&
    shiftPastCutoff(selectedShift, scheduleCutoff ?? null) &&
    emergencyOverrideReason.trim().length < EMERGENCY_OVERRIDE_MIN_LEN;

  /** Wait for debounced 7th-day reason to reach the preview query before confirming. */
  const seventhReasonDebouncePending =
    showSeventhDayReasonField && seventhReason.trim() !== debouncedSeventhForPreview.trim();

  const canConfirm =
    Boolean(preview?.ok) &&
    Boolean(shiftId) &&
    !commitMut.isPending &&
    !previewQuery.isError &&
    !commitNeedsEmergency &&
    !seventhReasonDebouncePending;

  if (!open) return null;

  return (
    <div className="schedule-modal-root" role="presentation">
      <button type="button" className="schedule-modal-backdrop" aria-label="Close" onClick={onClose} />
      <div
        className="schedule-modal schedule-modal--assign"
        role="dialog"
        aria-modal="true"
        aria-labelledby="schedule-cell-dialog-title"
      >
        <div className="schedule-modal__head">
          <h2 id="schedule-cell-dialog-title" className="schedule-modal__title">
            Assign {staffName}
          </h2>
          <p className="muted small schedule-modal__subtitle">
            {dayYmd} · times in {locationTz}
          </p>
          <button
            type="button"
            className="btn btn--ghost schedule-modal__close"
            onClick={onClose}
            aria-label="Close"
            title="Close"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
              <path
                fill="currentColor"
                d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 0 0 5.7 7.11L10.59 12 5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4Z"
              />
            </svg>
          </button>
        </div>

        <div className="schedule-modal__scroll">
        {showEmergencyField ? (
          <label className="field">
            <span className="field__label">Emergency override reason</span>
            <textarea
              value={emergencyOverrideReason}
              onChange={(e) => setEmergencyOverrideReason(e.target.value)}
              rows={3}
              placeholder={`Required for changes within the edit cutoff (min. ${EMERGENCY_OVERRIDE_MIN_LEN} characters).`}
            />
            <span className="muted small">
              This week includes published shifts inside the cutoff window. Document why you are changing assignments.
            </span>
          </label>
        ) : null}

        {existingAssignmentsToday.length > 0 ? (
          <div className="stack schedule-assign-existing">
            <h3 className="schedule-assign-existing__title">Assigned this day</h3>
            <ul className="schedule-assign-existing__list">
              {existingAssignmentsToday.map(({ assignmentId, shift }) => (
                <li key={assignmentId} className="schedule-assign-existing__row">
                  <span className="muted small">
                    {formatShiftTimeRangeShort(shift.startAtUtc, shift.endAtUtc, locationTz)} ·{" "}
                    {skillNameById.get(shift.requiredSkillId) ?? "—"}
                  </span>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm text-error"
                    disabled={removeMut.isPending}
                    onClick={() => void removeMut.mutateAsync({ assignmentId, shift })}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <p className="muted small schedule-assign-existing__hint">
              To move them to a different shift, remove the assignment here, then pick a new shift below.
            </p>
            {removeMut.isError ? (
              <ConstraintAlert variant="error" title="Could not remove assignment">
                {removeMut.error instanceof Error ? removeMut.error.message : "Try again."}
              </ConstraintAlert>
            ) : null}
          </div>
        ) : null}

        {eligibleShifts.length === 0 ? (
          <ConstraintAlert variant="info" title="No open matching shifts this day">
            <>
              {existingAssignmentsToday.length > 0 ? (
                <p className="constraint-alert__p constraint-alert__p--hint">
                  This person is already assigned on this day, and there aren’t any other open shifts that match their
                  skills and have available slots. Remove an assignment above to move them, or pick another staff member.
                </p>
              ) : openShiftsToday.length > 0 ? (
                <p className="constraint-alert__p constraint-alert__p--hint">
                  This day does have open shifts, but they require a different skill.{" "}
                  {suggestedStaffNames.length > 0 ? (
                    <>
                      For example, <strong>{suggestedStaffNames.join(", ")}</strong>{" "}
                      {suggestedStaffNames.length === 1 ? "has" : "have"} the required skill for at least one open shift.
                    </>
                  ) : null}
                </p>
              ) : shiftsToday.length > 0 ? (
                <p className="constraint-alert__p constraint-alert__p--hint">
                  All shifts on this day are already fully staffed.
                </p>
              ) : (
                <p className="constraint-alert__p constraint-alert__p--hint">There are no shifts on this day yet.</p>
              )}
              {onAddShiftForDay ? (
                <div className="constraint-alert__footer-actions">
                  <button
                    type="button"
                    className="btn btn--primary btn--sm"
                    onClick={() => onAddShiftForDay(dayYmd)}
                  >
                    Add shift for this day
                  </button>
                </div>
              ) : null}
            </>
          </ConstraintAlert>
        ) : (
          <>
            <label className="field">
              <span className="field__label">Shift</span>
              <select
                value={shiftId}
                onChange={(e) => {
                  setShiftId(e.target.value);
                  setSeventhReason("");
                  setCommitResult(null);
                }}
              >
                {eligibleShifts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {formatShiftTimeRangeShort(s.startAtUtc, s.endAtUtc, locationTz)} ·{" "}
                    {skillNameById.get(s.requiredSkillId) ?? "Skill"} · {s.status}
                  </option>
                ))}
              </select>
            </label>

            {previewLoadingInitial ? (
              <p className="muted small schedule-assign-preview-status" role="status">
                Checking assignment…
              </p>
            ) : null}

            {previewQuery.isFetching && previewQuery.data ? (
              <p className="muted small schedule-assign-preview-status schedule-assign-preview-status--inline" role="status">
                Updating preview…
              </p>
            ) : null}

            {previewQuery.isError ? (
              <ConstraintAlert variant="error" title="Could not check assignment">
                <p className="constraint-alert__p constraint-alert__p--hint">
                  Confirm you manage this location and try again.{" "}
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => void previewQuery.refetch()}
                  >
                    Retry
                  </button>
                </p>
              </ConstraintAlert>
            ) : null}

            {preview ? (
              <div
                className={`stack schedule-assign-preview-block${previewQuery.isFetching && previewQuery.data ? " schedule-assign-preview-block--refreshing" : ""}`}
              >
                <div className={preview.ok ? "preview-outcome preview-outcome--ok" : "preview-outcome preview-outcome--blocked"}>
                  {preview.ok
                    ? "This assignment is allowed."
                    : "This assignment can’t go through yet—see what’s blocking it below."}
                </div>
                {preview.laborImpact ? (
                  <div className="schedule-assign-labor-impact" aria-label="Labor impact preview">
                    <p className="schedule-assign-labor-impact__title">If you confirm (this site, this week)</p>
                    <ul className="schedule-assign-labor-impact__grid">
                      <li className="schedule-assign-labor-impact__stat">
                        <span className="schedule-assign-labor-impact__label">Rate used</span>
                        <span className="schedule-assign-labor-impact__value">
                          {formatUsd(preview.laborImpact.hourlyRateUsd)}/h
                        </span>
                      </li>
                      <li className="schedule-assign-labor-impact__stat">
                        <span className="schedule-assign-labor-impact__label">Week scheduled</span>
                        <span className="schedule-assign-labor-impact__value schedule-assign-labor-impact__value--transition">
                          <span>{fmtHoursFromMin(preview.laborImpact.weeklyBaselineMinutes)}</span>
                          <span className="schedule-assign-labor-impact__arrow" aria-hidden>
                            →
                          </span>
                          <span>{fmtHoursFromMin(preview.laborImpact.weeklyAfterMinutes)}</span>
                        </span>
                      </li>
                      <li className="schedule-assign-labor-impact__stat">
                        <span className="schedule-assign-labor-impact__label">This shift</span>
                        <span className="schedule-assign-labor-impact__value">
                          {fmtHoursFromMin(preview.laborImpact.hypotheticalShiftStraightMinutes)} straight
                          {preview.laborImpact.hypotheticalShiftOtMinutes > 0 ? (
                            <>
                              <span className="schedule-assign-labor-impact__sep">,</span>{" "}
                              {fmtHoursFromMin(preview.laborImpact.hypotheticalShiftOtMinutes)} OT
                            </>
                          ) : null}
                        </span>
                      </li>
                      <li className="schedule-assign-labor-impact__stat">
                        <span className="schedule-assign-labor-impact__label">Week labor</span>
                        <span className="schedule-assign-labor-impact__value schedule-assign-labor-impact__value--transition">
                          <span>{formatUsd(preview.laborImpact.baselineLaborUsd)}</span>
                          <span className="schedule-assign-labor-impact__arrow" aria-hidden>
                            →
                          </span>
                          <span>{formatUsd(preview.laborImpact.projectedLaborUsd)}</span>
                        </span>
                      </li>
                      <li className="schedule-assign-labor-impact__stat schedule-assign-labor-impact__stat--delta">
                        <span className="schedule-assign-labor-impact__label">Δ cost</span>
                        <span className="schedule-assign-labor-impact__value schedule-assign-labor-impact__value--delta">
                          {formatUsd(preview.laborImpact.deltaLaborUsd)}
                        </span>
                      </li>
                    </ul>
                  </div>
                ) : null}
                <ConstraintViolationCards violations={preview.hardViolations} heading="Blocking issues" />
                <ConstraintViolationCards violations={preview.warnings} heading="Warnings" />
                {showSeventhDayReasonField ? (
                  <label className="field schedule-assign-seventh-override">
                    <span className="field__label">7th consecutive work day — documented reason (required)</span>
                    <textarea
                      value={seventhReason}
                      onChange={(e) => setSeventhReason(e.target.value)}
                      rows={3}
                      placeholder="Explain why this 7th day in a row is approved (stored with the assignment)."
                    />
                    <span className="muted small">
                      Warnings above stay visible for policy context. Enter a note to clear the block; the same text is
                      saved on commit and appears in the assignment audit record for admins.
                    </span>
                  </label>
                ) : null}
                {!preview.ok ? (
                  <AssignmentAlternativesHint
                    alternatives={preview.alternatives}
                    ineligibleCandidates={preview.ineligibleCandidates}
                    showEmptyPoolHint={
                      preview.alternatives.length === 0 && preview.ineligibleCandidates.length === 0
                    }
                  />
                ) : null}
              </div>
            ) : null}

            {commitMut.isError ? (
              <ConstraintAlert variant="error" title="Could not save assignment">
                Check your connection and try again.
              </ConstraintAlert>
            ) : null}

            {commitResult && !commitResult.success && !commitResult.conflict ? (
              <div className="stack">
                <ConstraintAlert variant="error" title="Assignment was not saved">
                  Fix the blocking issues, then try again.
                </ConstraintAlert>
                <ConstraintViolationCards violations={commitResult.hardViolations} heading="Blocking issues" />
                <ConstraintViolationCards violations={commitResult.warnings} heading="Warnings" />
                <AssignmentAlternativesHint
                  alternatives={commitResult.alternatives ?? []}
                  ineligibleCandidates={commitResult.ineligibleCandidates ?? []}
                  showEmptyPoolHint={
                    (commitResult.alternatives?.length ?? 0) === 0 &&
                    (commitResult.ineligibleCandidates?.length ?? 0) === 0
                  }
                />
              </div>
            ) : null}
            {commitResult?.conflict ? (
              <ConstraintAlert variant="error" title="Could not save">
                {commitResult.message ?? "Refresh and try again."}
              </ConstraintAlert>
            ) : null}

            <div className="btn-row btn-row--single">
              <button
                type="button"
                className="btn btn--primary"
                disabled={!canConfirm}
                onClick={() => void commitMut.mutateAsync()}
              >
                {commitMut.isPending ? "Saving…" : "Confirm assignment"}
              </button>
            </div>
          </>
        )}
        </div>
      </div>
    </div>
  );
}
