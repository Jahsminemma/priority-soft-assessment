import type { LocationSummary } from "@shiftsync/shared";

export type ShiftTimeRangeFieldsProps = {
  location: LocationSummary | undefined;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  onStartDateChange: (v: string) => void;
  onStartTimeChange: (v: string) => void;
  onEndDateChange: (v: string) => void;
  onEndTimeChange: (v: string) => void;
  disabled?: boolean;
  /** When true, show how dates interact with Mon–Fri repeat. */
  repeatWeekdays?: boolean;
  /** Earliest selectable calendar day (YYYY-MM-DD), e.g. max(week Monday, today). */
  minDate?: string;
};

/**
 * Date + time pickers for shift bounds, labeled in the location’s IANA timezone.
 * Uses native date/time inputs (browser calendar & clock UI).
 */
export function ShiftTimeRangeFields({
  location,
  startDate,
  startTime,
  endDate,
  endTime,
  onStartDateChange,
  onStartTimeChange,
  onEndDateChange,
  onEndTimeChange,
  disabled = false,
  repeatWeekdays = false,
  minDate,
}: ShiftTimeRangeFieldsProps): React.ReactElement {
  const zone = location?.tzIana ?? "UTC";
  const place = location?.name ?? "this location";

  return (
    <div className="shift-time-range">
      <div className="shift-time-range__header">
        <div>
          <span className="shift-time-range__title">Shift start &amp; end</span>
          <p className="shift-time-range__subtitle muted">
            Times are in the <strong>{place}</strong> timezone ({zone}).
          </p>
          {repeatWeekdays ? (
            <p className="shift-time-range__repeat-banner muted">
              <strong>Mon–Fri repeat:</strong> the same start/end times are applied to each weekday. Start and end dates
              only indicate <em>same calendar day</em> vs <em>end the next morning</em> (overnight).
            </p>
          ) : null}
        </div>
      </div>

      <div className="shift-time-range__blocks">
        <div className="shift-time-range__block">
          <span className="shift-time-range__block-label">Starts</span>
          <div className="shift-time-range__inputs">
            <label className="shift-time-range__control">
              <span className="visually-hidden">Start date</span>
              <input
                type="date"
                className="shift-time-range__input shift-time-range__input--date"
                value={startDate}
                min={minDate}
                disabled={disabled}
                onChange={(e) => onStartDateChange(e.target.value)}
              />
            </label>
            <label className="shift-time-range__control">
              <span className="visually-hidden">Start time</span>
              <input
                type="time"
                className="shift-time-range__input shift-time-range__input--time"
                value={startTime}
                disabled={disabled}
                onChange={(e) => onStartTimeChange(e.target.value)}
              />
            </label>
          </div>
        </div>

        <div className="shift-time-range__connector" aria-hidden>
          <span className="shift-time-range__arrow">→</span>
        </div>

        <div className="shift-time-range__block">
          <span className="shift-time-range__block-label">Ends</span>
          <div className="shift-time-range__inputs">
            <label className="shift-time-range__control">
              <span className="visually-hidden">End date</span>
              <input
                type="date"
                className="shift-time-range__input shift-time-range__input--date"
                value={endDate}
                min={minDate}
                disabled={disabled}
                onChange={(e) => onEndDateChange(e.target.value)}
              />
            </label>
            <label className="shift-time-range__control">
              <span className="visually-hidden">End time</span>
              <input
                type="time"
                className="shift-time-range__input shift-time-range__input--time"
                value={endTime}
                disabled={disabled}
                onChange={(e) => onEndTimeChange(e.target.value)}
              />
            </label>
          </div>
        </div>
      </div>

      <div className="shift-time-range__presets">
        <span className="shift-time-range__presets-label muted">Quick times</span>
        <div className="shift-time-range__preset-btns">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={disabled}
            onClick={() => {
              onStartTimeChange("09:00");
              onEndTimeChange("17:00");
            }}
          >
            Day 9–5
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={disabled}
            onClick={() => {
              onStartTimeChange("17:00");
              onEndTimeChange("23:00");
            }}
          >
            Evening
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={disabled}
            onClick={() => {
              onStartTimeChange("23:00");
              onEndTimeChange("07:00");
            }}
          >
            Overnight
          </button>
        </div>
        <p className="shift-time-range__preset-hint muted">
          Overnight presets expect the end <strong>date</strong> to be the next day—adjust the end date if needed.
        </p>
      </div>
    </div>
  );
}
