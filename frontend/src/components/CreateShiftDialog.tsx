import { useEffect, useId, useMemo, useState, type ReactElement } from "react";
import type { LocationSummary } from "@shiftsync/shared";
import { ShiftTimeRangeFields } from "./ShiftTimeRangeFields.js";
import { maxYmd } from "../utils/weekKey.js";

type SkillOption = { id: string; name: string };

type Props = {
  open: boolean;
  onClose: () => void;
  location: LocationSummary | null;
  locationTz: string;
  minShiftDateYmd: string;
  skills: SkillOption[];
  defaultSkillId: string;
  defaultHeadcount: number;
  defaultIsPremium: boolean;
  dayYmd: string | null;
  onCreate: (input: {
    requiredSkillId: string;
    headcount: number;
    isPremium: boolean;
    repeatMonFri: boolean;
    startDate: string;
    startTime: string;
    endDate: string;
    endTime: string;
  }) => Promise<void>;
  pending?: boolean;
  error?: string | null;
};

export function CreateShiftDialog({
  open,
  onClose,
  location,
  locationTz,
  minShiftDateYmd,
  skills,
  defaultSkillId,
  defaultHeadcount,
  defaultIsPremium,
  dayYmd,
  onCreate,
  pending = false,
  error = null,
}: Props): ReactElement | null {
  const titleId = useId();

  const clampYmd = (v: string): string => (v < minShiftDateYmd ? minShiftDateYmd : v);

  const initialDay = useMemo(() => (dayYmd ? maxYmd(dayYmd, minShiftDateYmd) : minShiftDateYmd), [dayYmd, minShiftDateYmd]);

  const [requiredSkillId, setRequiredSkillId] = useState(defaultSkillId);
  const [headcount, setHeadcount] = useState(defaultHeadcount);
  const [isPremium, setIsPremium] = useState(defaultIsPremium);
  const [repeatMonFri, setRepeatMonFri] = useState(false);
  const [startDate, setStartDate] = useState(initialDay);
  const [startTime, setStartTime] = useState("09:00");
  const [endDate, setEndDate] = useState(initialDay);
  const [endTime, setEndTime] = useState("17:00");

  useEffect(() => {
    if (!open) return;
    setRequiredSkillId(defaultSkillId);
    setHeadcount(defaultHeadcount);
    setIsPremium(defaultIsPremium);
    setRepeatMonFri(false);
    setStartDate(initialDay);
    setEndDate(initialDay);
    setStartTime("09:00");
    setEndTime("17:00");
  }, [open, defaultSkillId, defaultHeadcount, defaultIsPremium, initialDay]);

  if (!open) return null;

  return (
    <div className="schedule-modal-root" role="presentation">
      <button type="button" className="schedule-modal-backdrop" aria-label="Close" onClick={onClose} />
      <div className="schedule-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="schedule-modal__head">
          <h2 id={titleId} className="schedule-modal__title">
            Create shift
          </h2>
          <p className="muted small schedule-modal__subtitle">
            {startDate} · {location?.name ?? "Location"} · times in {locationTz}
          </p>
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

        <div className="stack">
          <div className="row-2">
            <label className="field">
              <span className="field__label">Required skill</span>
              <select value={requiredSkillId} onChange={(e) => setRequiredSkillId(e.target.value)} disabled={pending}>
                {skills.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
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
          </div>

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
              repeatWeekdays={repeatMonFri}
              minDate={minShiftDateYmd}
            />
          </div>

          <label className="checkbox-field">
            <input
              className="checkbox-field__input"
              type="checkbox"
              checked={repeatMonFri}
              disabled={pending}
              onChange={(e) => setRepeatMonFri(e.target.checked)}
            />
            <span className="checkbox-field__label">Repeat weekdays (Mon–Fri)</span>
          </label>

          <label className="checkbox-field">
            <input
              className="checkbox-field__input"
              type="checkbox"
              checked={isPremium}
              disabled={pending}
              onChange={(e) => setIsPremium(e.target.checked)}
            />
            <span className="checkbox-field__label">Premium shift</span>
          </label>

          {error ? (
            <div className="constraint-alert constraint-alert--error" role="alert">
              <div className="constraint-alert__title">Could not create shift</div>
              <div className="constraint-alert__body">{error}</div>
            </div>
          ) : null}

          <div className="btn-row btn-row--single">
            <button
              type="button"
              className="btn btn--primary"
              disabled={pending || !location || !requiredSkillId}
              onClick={() =>
                void onCreate({
                  requiredSkillId,
                  headcount,
                  isPremium,
                  repeatMonFri,
                  startDate,
                  startTime,
                  endDate,
                  endTime,
                }).then(onClose)
              }
            >
              {pending ? "Creating…" : "Create shift"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

