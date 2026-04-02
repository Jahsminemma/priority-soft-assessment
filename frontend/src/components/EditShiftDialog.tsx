import { useEffect, useId, useMemo, useState, type ReactElement } from "react";
import { DateTime } from "luxon";
import { EMERGENCY_OVERRIDE_MIN_LEN, type LocationSummary, type ShiftDto } from "@shiftsync/shared";
import { ShiftTimeRangeFields } from "./ShiftTimeRangeFields.js";
import { ConstraintAlert } from "./ConstraintAlert.js";
import { ShiftHistoryTimeline } from "./ShiftHistoryTimeline.js";
import { maxYmd } from "../utils/weekKey.js";

type SkillOption = { id: string; name: string };

type Props = {
  open: boolean;
  onClose: () => void;
  shift: ShiftDto | null;
  location: LocationSummary | null;
  locationTz: string;
  minShiftDateYmd: string;
  skills: SkillOption[];
  onSave: (input: {
    startAtUtc: string;
    endAtUtc: string;
    headcount: number;
    emergencyOverrideReason?: string;
  }) => Promise<void>;
  onDelete?: (input: { emergencyOverrideReason?: string }) => Promise<void>;
  deletePending?: boolean;
  /** Published shift is past the per-shift edit cutoff — managers must document an emergency reason. */
  pastCutoffLocked?: boolean;
  pending?: boolean;
  error?: string | null;
  deleteError?: string | null;
};

function utcToLocalYmd(isoUtc: string, zone: string): string {
  return DateTime.fromISO(isoUtc, { zone: "utc" }).setZone(zone).toFormat("yyyy-LL-dd");
}

function utcToLocalHm(isoUtc: string, zone: string): string {
  return DateTime.fromISO(isoUtc, { zone: "utc" }).setZone(zone).toFormat("HH:mm");
}

function parseShiftUpdateError(error: string): { staffName: string | null; reason: string | null } {
  const marker = "Cannot update shift because ";
  const rule = " would violate assignment constraints: ";
  if (!error.startsWith(marker) || !error.includes(rule)) {
    return { staffName: null, reason: null };
  }
  const body = error.slice(marker.length);
  const idx = body.indexOf(rule.trimStart());
  if (idx < 0) return { staffName: null, reason: null };
  const staffName = body.slice(0, idx).trim() || null;
  const reason = body.slice(idx + rule.trimStart().length).trim() || null;
  return { staffName, reason };
}

export function EditShiftDialog({
  open,
  onClose,
  shift,
  location,
  locationTz,
  minShiftDateYmd,
  skills,
  onSave,
  onDelete,
  deletePending = false,
  pastCutoffLocked = false,
  pending = false,
  error = null,
  deleteError = null,
}: Props): ReactElement | null {
  const titleId = useId();
  const [activeTab, setActiveTab] = useState<"edit" | "history">("edit");

  const clampYmd = (v: string): string => (v < minShiftDateYmd ? minShiftDateYmd : v);

  const initialStartDate = useMemo(() => {
    if (!shift) return minShiftDateYmd;
    return maxYmd(utcToLocalYmd(shift.startAtUtc, locationTz), minShiftDateYmd);
  }, [shift, locationTz, minShiftDateYmd]);

  const initialEndDate = useMemo(() => {
    if (!shift) return minShiftDateYmd;
    return maxYmd(utcToLocalYmd(shift.endAtUtc, locationTz), minShiftDateYmd);
  }, [shift, locationTz, minShiftDateYmd]);

  const [headcount, setHeadcount] = useState(1);
  const [emergencyReason, setEmergencyReason] = useState("");
  const [startDate, setStartDate] = useState(initialStartDate);
  const [startTime, setStartTime] = useState("09:00");
  const [endDate, setEndDate] = useState(initialEndDate);
  const [endTime, setEndTime] = useState("17:00");

  useEffect(() => {
    if (!open) setActiveTab("edit");
  }, [open]);

  useEffect(() => {
    if (!open || !shift) return;
    setEmergencyReason("");
    setHeadcount(shift.headcount);
    setStartDate(initialStartDate);
    setEndDate(initialEndDate);
    setStartTime(utcToLocalHm(shift.startAtUtc, locationTz));
    setEndTime(utcToLocalHm(shift.endAtUtc, locationTz));
  }, [open, shift, initialStartDate, initialEndDate, locationTz]);

  if (!open || !shift) return null;

  const skillLabel = skills.find((s) => s.id === shift.requiredSkillId)?.name ?? "Skill";
  const parsedError = error ? parseShiftUpdateError(error) : { staffName: null, reason: null };
  const emergencyOk =
    !pastCutoffLocked || emergencyReason.trim().length >= EMERGENCY_OVERRIDE_MIN_LEN;

  return (
    <div className="schedule-modal-root" role="presentation">
      <button type="button" className="schedule-modal-backdrop" aria-label="Close" onClick={onClose} />
      <div
        className="schedule-modal schedule-modal--edit-shift"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="schedule-modal__head">
          <div>
            <h2 id={titleId} className="schedule-modal__title">
              Edit shift
            </h2>
            <p className="muted small schedule-modal__subtitle">
              {location?.name ?? "Location"} · {skillLabel} · times in {locationTz}
            </p>
          </div>
          <button
            type="button"
            className="btn btn--ghost schedule-modal__close"
            onClick={onClose}
            disabled={pending}
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

        <div className="edit-shift-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "edit"}
            className={`edit-shift-tabs__tab${activeTab === "edit" ? " edit-shift-tabs__tab--active" : ""}`}
            onClick={() => setActiveTab("edit")}
          >
            Edit
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "history"}
            className={`edit-shift-tabs__tab${activeTab === "history" ? " edit-shift-tabs__tab--active" : ""}`}
            onClick={() => setActiveTab("history")}
          >
            History
          </button>
        </div>

        <div className="schedule-modal__scroll">
          {activeTab === "history" ? (
            <ShiftHistoryTimeline shiftId={shift.id} locationTz={locationTz} />
          ) : null}
          <div className="stack" style={activeTab === "history" ? { display: "none" } : undefined}>
          <label className="field">
            <span className="field__label">Headcount</span>
            <input
              type="number"
              min={1}
              value={headcount}
              onChange={(e) => setHeadcount(Number(e.target.value))}
              disabled={pending}
            />
          </label>

          <div className="schedule-shift-time-panel">
            <div className="schedule-shift-time-panel__bar">
              <button type="button" className="btn btn--secondary btn--sm" onClick={onClose} disabled={pending}>
                Cancel
              </button>
            </div>
            <ShiftTimeRangeFields
              location={location ?? undefined}
              startDate={startDate}
              startTime={startTime}
              endDate={endDate}
              endTime={endTime}
              onStartDateChange={(v) => setStartDate(clampYmd(v))}
              onStartTimeChange={setStartTime}
              onEndDateChange={(v) => setEndDate(clampYmd(v))}
              onEndTimeChange={setEndTime}
              disabled={pending}
              repeatWeekdays={false}
              minDate={minShiftDateYmd}
            />
          </div>

          {error ? (
            <ConstraintAlert variant="error" title="Could not update shift">
              {parsedError.staffName && parsedError.reason ? (
                <>
                  <p className="constraint-alert__p">
                    <strong>{parsedError.staffName}</strong> would no longer meet assignment rules after this edit.
                  </p>
                  <p className="constraint-alert__p constraint-alert__p--hint">{parsedError.reason}</p>
                </>
              ) : (
                <p className="constraint-alert__p">{error}</p>
              )}
            </ConstraintAlert>
          ) : null}

          {deleteError ? (
            <ConstraintAlert variant="error" title="Could not delete shift">
              <p className="constraint-alert__p">{deleteError}</p>
            </ConstraintAlert>
          ) : null}

          {pastCutoffLocked ? (
            <label className="field">
              <span className="field__label">Emergency override reason (required)</span>
              <textarea
                value={emergencyReason}
                onChange={(e) => setEmergencyReason(e.target.value)}
                disabled={pending}
                rows={3}
                placeholder={`At least ${EMERGENCY_OVERRIDE_MIN_LEN} characters — e.g. urgent coverage change, verified call-out`}
              />
              <span className="muted small">This shift is within the schedule edit cutoff; changes need a documented reason.</span>
            </label>
          ) : null}

          <div className="btn-row btn-row--single">
            {onDelete ? (
              <button
                type="button"
                className="btn btn--secondary"
                disabled={pending || deletePending || !emergencyOk}
                onClick={() => {
                  const em = emergencyReason.trim();
                  void onDelete({
                    ...(pastCutoffLocked && em.length >= EMERGENCY_OVERRIDE_MIN_LEN ? { emergencyOverrideReason: em } : {}),
                  }).then(onClose);
                }}
                title={pastCutoffLocked ? "Delete shift (emergency reason required)" : "Delete shift"}
              >
                {deletePending ? "Deleting…" : "Delete shift"}
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn--primary"
              disabled={pending || !emergencyOk}
              onClick={() => {
                const sIso = DateTime.fromISO(`${startDate}T${startTime}:00`, { zone: locationTz }).toUTC().toISO();
                const eIso = DateTime.fromISO(`${endDate}T${endTime}:00`, { zone: locationTz }).toUTC().toISO();
                if (!sIso || !eIso) return;
                const em = emergencyReason.trim();
                void onSave({
                  startAtUtc: sIso,
                  endAtUtc: eIso,
                  headcount,
                  ...(pastCutoffLocked && em.length >= EMERGENCY_OVERRIDE_MIN_LEN
                    ? { emergencyOverrideReason: em }
                    : {}),
                }).then(onClose);
              }}
            >
              {pending ? "Saving…" : "Save changes"}
            </button>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}

