import { useEffect, useState } from "react";
import { compareIsoWeekKeys, normalizeIsoWeekKey } from "@shiftsync/shared";
import {
  formatWeekRangeLabel,
  isValidWeekKey,
  localDateStringToWeekKey,
  shiftWeekKey,
  todayLocalYmd,
  weekKeyToLocalMondayYmd,
} from "../utils/weekKey.js";

type WeekPickerProps = {
  weekKey: string;
  onWeekKeyChange: (weekKey: string) => void;
  id?: string;
  /** If set, navigation cannot go to an ISO week before this key (e.g. current week). */
  minWeekKey?: string;
  /**
   * Single-row layout: nav + range + date (for toolbars). Omits stacked labels and footer hint.
   */
  compact?: boolean;
};

/**
 * ISO week (YYYY-Www). Previous / Next move from the **currently selected** week.
 */
export function WeekPicker({ weekKey, onWeekKeyChange, id, minWeekKey, compact = false }: WeekPickerProps): React.ReactElement {
  const [dateValue, setDateValue] = useState(() =>
    isValidWeekKey(weekKey) ? weekKeyToLocalMondayYmd(weekKey) ?? "" : "",
  );

  useEffect(() => {
    if (!isValidWeekKey(weekKey)) return;
    const mon = weekKeyToLocalMondayYmd(weekKey);
    if (mon) setDateValue(mon);
  }, [weekKey]);

  const rangeLabel = isValidWeekKey(weekKey) ? formatWeekRangeLabel(weekKey) : null;

  const atMinWeek =
    minWeekKey != null &&
    isValidWeekKey(weekKey) &&
    compareIsoWeekKeys(normalizeIsoWeekKey(weekKey), normalizeIsoWeekKey(minWeekKey)) <= 0;

  const applyWeekKey = (next: string): void => {
    const mon = weekKeyToLocalMondayYmd(next);
    if (mon) setDateValue(mon);
    onWeekKeyChange(next);
  };

  const navButtons = (
    <div className={`week-picker__nav btn-row${compact ? " week-picker__nav--compact" : ""}`}>
      <button
        type="button"
        className={`btn btn--secondary${compact ? " btn--sm" : ""}`}
        disabled={!isValidWeekKey(weekKey) || atMinWeek}
        onClick={() => {
          const prev = shiftWeekKey(weekKey, -1);
          if (prev) applyWeekKey(prev);
        }}
      >
        ← Prev
      </button>
      <button
        type="button"
        className={`btn btn--secondary${compact ? " btn--sm" : ""}`}
        onClick={() => {
          const ymd = todayLocalYmd();
          setDateValue(ymd);
          onWeekKeyChange(localDateStringToWeekKey(ymd));
        }}
      >
        This week
      </button>
      <button
        type="button"
        className={`btn btn--secondary${compact ? " btn--sm" : ""}`}
        disabled={!isValidWeekKey(weekKey)}
        onClick={() => {
          const next = shiftWeekKey(weekKey, 1);
          if (next) applyWeekKey(next);
        }}
      >
        Next →
      </button>
    </div>
  );

  const dateJump = (
    <label className={`week-picker__jump field${compact ? " week-picker__jump--compact" : ""}`} htmlFor={id}>
      <span className={`field__label${compact ? " visually-hidden" : ""}`}>{compact ? "Week" : "Go to date"}</span>
      <input
        id={id}
        type="date"
        value={dateValue}
        onChange={(e) => {
          const v = e.target.value;
          setDateValue(v);
          if (!v) return;
          try {
            let next = localDateStringToWeekKey(v);
            if (minWeekKey != null && compareIsoWeekKeys(normalizeIsoWeekKey(next), normalizeIsoWeekKey(minWeekKey)) < 0) {
              next = normalizeIsoWeekKey(minWeekKey);
            }
            onWeekKeyChange(next);
          } catch {
            /* ignore */
          }
        }}
      />
    </label>
  );

  if (compact) {
    return (
      <div className="week-picker week-picker--compact" role="group" aria-label="Schedule week">
        <div className="week-picker__compact-row week-picker__compact-row--nav">{navButtons}</div>
        <div className="week-picker__compact-row week-picker__compact-row--range">
          <div className="week-picker__compact-range">
            {rangeLabel ? (
              <>
                <span className="week-picker__dates" aria-live="polite">
                  {rangeLabel}
                </span>
                <span className="week-picker__code mono">{weekKey}</span>
              </>
            ) : (
              <span className="muted">{weekKey}</span>
            )}
          </div>
          {dateJump}
        </div>
      </div>
    );
  }

  return (
    <div className="week-picker">
      <div className="week-picker__summary">
        <span className="field__label">Schedule week</span>
        {rangeLabel ? (
          <div className="week-picker__summary-line">
            <span className="week-picker__dates" aria-live="polite">
              {rangeLabel}
            </span>
            <span className="week-picker__code mono">{weekKey}</span>
          </div>
        ) : (
          <span className="muted">{weekKey}</span>
        )}
      </div>

      <div className="week-picker__controls">
        {navButtons}
        {dateJump}
      </div>

      <p className="field-hint week-picker__hint">Mon–Sun · pick any day in the week. Lists use the full week.</p>
    </div>
  );
}
