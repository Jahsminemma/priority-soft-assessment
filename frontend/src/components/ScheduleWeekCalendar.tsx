import { useEffect, useId, useMemo, type ChangeEvent, type ReactElement, type ReactNode } from "react";
import { DateTime } from "luxon";
import type { LocationSummary, ShiftDto } from "@shiftsync/shared";
import { compareIsoWeekKeys, normalizeIsoWeekKey } from "@shiftsync/shared";
import {
  formatShiftTimeRangeShort,
  formatWeekRangeCompactInZone,
  isoWeekDayKeysInLocationZone,
  utcIsoToLocalYmd,
  weekKeyMondayYmdInZone,
} from "../utils/scheduleTime.js";
import {
  localDateStringToWeekKey,
  shiftWeekKey,
  weekKeyToLocalMondayYmd,
} from "../utils/weekKey.js";
import type { ShiftAssignmentRow } from "../types/shiftAssignment.js";

export type StaffRosterRow = { id: string; name: string; skillIds: Set<string> };

/** Matches legend: Bartender (purple), Line Cook (rust), Server (blue), Host (green). Unknown skills fall back to a stable hash color. */
const SKILL_LEGEND_HEX: Record<string, string> = {
  bartender: "#7c3aed",
  line_cook: "#c45621",
  server: "#3b82f6",
  host: "#16a34a",
};

function normalizeSkillKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "_");
}

function hashSkillColor(skillId: string): string {
  let hash = 0;
  for (let i = 0; i < skillId.length; i++) hash = skillId.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 45%)`;
}

/** Calendar accent for a skill (pills, dots) — uses legend when the skill name matches. */
function colorForSkill(skillId: string, skillName: string | undefined): string {
  if (!skillName) return hashSkillColor(skillId);
  const key = normalizeSkillKey(skillName);
  const hex = SKILL_LEGEND_HEX[key];
  return hex ?? hashSkillColor(skillId);
}

function formatSkillDisplayName(raw: string): string {
  return raw
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function staffNameInitial(name: string): string {
  const t = name.trim();
  if (!t) return "?";
  return t[0]!.toUpperCase();
}

function shiftDurationHours(startAtUtc: string, endAtUtc: string): number {
  const a = DateTime.fromISO(startAtUtc, { zone: "utc" });
  const b = DateTime.fromISO(endAtUtc, { zone: "utc" });
  if (!a.isValid || !b.isValid) return 0;
  return Math.max(0, b.diff(a, "hours").hours);
}

function staffHoursInWeek(
  staffId: string,
  dayKeys: readonly string[],
  shifts: ShiftDto[],
  shiftIndex: Map<string, number>,
  assignmentsPerShift: Array<ShiftAssignmentRow[] | undefined>,
  locationTz: string,
): number {
  let total = 0;
  for (const ymd of dayKeys) {
    for (const s of shifts) {
      if (utcIsoToLocalYmd(s.startAtUtc, locationTz) !== ymd) continue;
      const idx = shiftIndex.get(s.id);
      if (idx === undefined) continue;
      for (const a of assignmentsPerShift[idx] ?? []) {
        if (a.staffUserId === staffId) {
          total += shiftDurationHours(s.startAtUtc, s.endAtUtc);
        }
      }
    }
  }
  return total;
}

function formatWeekHoursLabel(hours: number): string {
  return `${hours.toFixed(1)}h`;
}

type Props = {
  locations: LocationSummary[];
  locationId: string;
  onLocationChange: (locationId: string) => void;
  locationsLoading?: boolean;
  weekKey: string;
  onWeekKeyChange: (weekKey: string) => void;
  minWeekKey?: string;
  locationTz: string;
  /** When set, scrolls this shift into view and highlights it (e.g. deep link from Manage shifts). */
  highlightShiftId?: string | null;
  shifts: ShiftDto[];
  assignmentsPerShift: Array<ShiftAssignmentRow[] | undefined>;
  assignmentsLoading: boolean;
  /** Assignments with marginal OT minutes (FIFO week at this site). */
  otAssignmentIds?: ReadonlySet<string>;
  skillNameById: Map<string, string>;
  staffRows: StaffRosterRow[];
  rosterLoading: boolean;
  onDayAddShift: (ymd: string) => void;
  onCellAssign: (staff: StaffRosterRow, dayYmd: string) => void;
  /** Managers can remove an existing assignment from the calendar cell. */
  onRemoveAssignment?: (assignmentId: string) => void;
  removeAssignmentPending?: boolean;
  onEditShift?: (shift: ShiftDto) => void;
  headerActions?: ReactNode;
  /** Compact status (e.g. cutoff) shown in the toolbar next to publish actions. */
  toolbarStatusNote?: ReactNode;
};

export function ScheduleWeekCalendar({
  locations,
  locationId,
  onLocationChange,
  locationsLoading = false,
  weekKey,
  onWeekKeyChange,
  minWeekKey,
  locationTz,
  highlightShiftId = null,
  shifts,
  assignmentsPerShift,
  assignmentsLoading,
  otAssignmentIds,
  skillNameById,
  staffRows,
  rosterLoading,
  onDayAddShift,
  onCellAssign,
  onRemoveAssignment,
  removeAssignmentPending = false,
  onEditShift,
  headerActions,
  toolbarStatusNote,
}: Props): ReactElement {
  const weekJumpId = useId();
  const dayKeys = useMemo(() => isoWeekDayKeysInLocationZone(weekKey, locationTz), [weekKey, locationTz]);

  useEffect(() => {
    if (!highlightShiftId) return;
    const el = document.querySelector<HTMLElement>(`[data-schedule-shift="${highlightShiftId}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlightShiftId, shifts, assignmentsLoading]);

  const rangeCompact = useMemo(
    () => formatWeekRangeCompactInZone(weekKey, locationTz),
    [weekKey, locationTz],
  );
  const monYmd = useMemo(
    () => weekKeyMondayYmdInZone(weekKey, locationTz) ?? weekKeyToLocalMondayYmd(weekKey) ?? "",
    [weekKey, locationTz],
  );
  const atMinWeek = useMemo(() => {
    if (minWeekKey == null) return false;
    return compareIsoWeekKeys(normalizeIsoWeekKey(weekKey), normalizeIsoWeekKey(minWeekKey)) <= 0;
  }, [weekKey, minWeekKey]);

  function goPrevWeek(): void {
    if (atMinWeek) return;
    const next = shiftWeekKey(weekKey, -1);
    if (next) onWeekKeyChange(normalizeIsoWeekKey(next));
  }

  function goNextWeek(): void {
    const next = shiftWeekKey(weekKey, 1);
    if (next) onWeekKeyChange(normalizeIsoWeekKey(next));
  }

  function onWeekJumpChange(e: ChangeEvent<HTMLInputElement>): void {
    const v = e.target.value;
    if (!v) return;
    let next = localDateStringToWeekKey(v);
    if (minWeekKey != null && compareIsoWeekKeys(normalizeIsoWeekKey(next), normalizeIsoWeekKey(minWeekKey)) < 0) {
      next = normalizeIsoWeekKey(minWeekKey);
    }
    onWeekKeyChange(next);
  }

  const dayMeta = useMemo(
    () =>
      dayKeys.map((ymd) => {
        const dt = DateTime.fromISO(ymd, { zone: locationTz });
        return {
          ymd,
          weekdayShort: dt.toFormat("ccc"),
          dayMonth: dt.toFormat("MMM d"),
        };
      }),
    [dayKeys, locationTz],
  );

  const shiftIndex = useMemo(() => new Map(shifts.map((s, i) => [s.id, i])), [shifts]);

  const staffWeekHours = useMemo(() => {
    const m = new Map<string, number>();
    for (const staff of staffRows) {
      m.set(
        staff.id,
        staffHoursInWeek(staff.id, dayKeys, shifts, shiftIndex, assignmentsPerShift, locationTz),
      );
    }
    return m;
  }, [staffRows, dayKeys, shifts, shiftIndex, assignmentsPerShift, locationTz]);

  const shiftsByDay = useMemo(() => {
    const m = new Map<string, ShiftDto[]>();
    for (const s of shifts) {
      const d = utcIsoToLocalYmd(s.startAtUtc, locationTz);
      const list = m.get(d) ?? [];
      list.push(s);
      m.set(d, list);
    }
    for (const list of m.values()) {
      list.sort((a, b) => a.startAtUtc.localeCompare(b.startAtUtc));
    }
    return m;
  }, [shifts, locationTz]);

  function openSlots(s: ShiftDto): number {
    const i = shiftIndex.get(s.id);
    if (i === undefined) return 0;
    const n = assignmentsPerShift[i]?.length ?? s.assignedCount ?? 0;
    return Math.max(0, s.headcount - n);
  }

  function assignmentsForStaffDay(
    staffId: string,
    ymd: string,
  ): Array<{ shift: ShiftDto; assignment: ShiftAssignmentRow }> {
    const out: Array<{ shift: ShiftDto; assignment: ShiftAssignmentRow }> = [];
    for (const s of shifts) {
      if (utcIsoToLocalYmd(s.startAtUtc, locationTz) !== ymd) continue;
      const idx = shiftIndex.get(s.id);
      if (idx === undefined) continue;
      const rows = assignmentsPerShift[idx] ?? [];
      for (const a of rows) {
        if (a.staffUserId === staffId) out.push({ shift: s, assignment: a });
      }
    }
    return out;
  }

  return (
    <div className="card schedule-cal-card">
      <div className="schedule-cal__control-bar">
        <div className="schedule-cal__header-left">
          <h2 className="schedule-cal__title">Schedule</h2>
          <div className="schedule-cal__week-pill" role="group" aria-label="Week">
            <button
              type="button"
              className="schedule-cal__week-nav"
              aria-label="Previous week"
              disabled={atMinWeek}
              onClick={goPrevWeek}
            >
              ‹
            </button>
            <label htmlFor={weekJumpId} className="schedule-cal__week-range">
              {rangeCompact}
            </label>
            <input
              id={weekJumpId}
              type="date"
              className="visually-hidden"
              value={monYmd}
              min={
                minWeekKey != null
                  ? weekKeyMondayYmdInZone(minWeekKey, locationTz) ?? weekKeyToLocalMondayYmd(minWeekKey) ?? undefined
                  : undefined
              }
              onChange={onWeekJumpChange}
            />
            <button type="button" className="schedule-cal__week-nav" aria-label="Next week" onClick={goNextWeek}>
              ›
            </button>
          </div>
        </div>
        <div className="schedule-cal__header-right">
          <label className="schedule-cal__location-select-wrap">
            <span className="visually-hidden">Location</span>
            <select
              className="schedule-cal__location-select schedule-cal__location-select--header"
              value={locationId}
              onChange={(e) => onLocationChange(e.target.value)}
              disabled={locationsLoading || locations.length === 0}
              title={locationTz ? `Shift times use ${locationTz}` : undefined}
            >
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <div className="schedule-cal__summary-badge" role="status" aria-live="polite">
            <svg className="schedule-cal__summary-icon" width="16" height="16" viewBox="0 0 24 24" aria-hidden>
              <path
                fill="currentColor"
                d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"
              />
            </svg>
            <span>
              {staffRows.length} staff · {shifts.length} shifts
            </span>
          </div>
          {toolbarStatusNote ? <div className="schedule-cal__toolbar-notes">{toolbarStatusNote}</div> : null}
          {headerActions ? <div className="schedule-cal__header-actions">{headerActions}</div> : null}
        </div>
        <p className="schedule-cal__hint muted">
          Pick <strong>location</strong> and <strong>week</strong> above, <strong>Add shift</strong> on a day, assign
          with <strong>+</strong> in a staff row.
        </p>
      </div>

      <div className="schedule-cal-scroll">
        <table className="schedule-cal">
          <thead>
            <tr>
              <th className="schedule-cal__sticky schedule-cal__corner" />
              {dayMeta.map((d) => (
                <th key={d.ymd} className="schedule-cal__dayhead">
                  <div className="schedule-cal__dayhead-label">{d.weekdayShort}</div>
                  <div className="schedule-cal__dayhead-date">{d.dayMonth}</div>
                  <button
                    type="button"
                    className="schedule-cal__add-card schedule-cal__add-card--day"
                    onClick={() => onDayAddShift(d.ymd)}
                  >
                    <span className="schedule-cal__add-card-icon" aria-hidden>
                      +
                    </span>
                    <span>Add shift</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="schedule-cal__row schedule-cal__row--open">
              <th scope="row" className="schedule-cal__sticky schedule-cal__rowhead">
                Open shifts
              </th>
              {dayMeta.map((d) => {
                const list = shiftsByDay.get(d.ymd) ?? [];
                const open = list.filter((s) => openSlots(s) > 0);
                return (
                  <td key={d.ymd} className="schedule-cal__cell">
                    {assignmentsLoading && list.length > 0 ? (
                      <span className="muted">…</span>
                    ) : (
                      <ul className="schedule-cal__shift-list">
                        {open.map((s) => (
                          <li key={s.id}>
                            <button
                              type="button"
                              data-schedule-shift={s.id}
                              className={`schedule-cal__shift-pill schedule-cal__shift-pill--click${
                                highlightShiftId === s.id ? " schedule-cal__shift-pill--highlight" : ""
                              }`}
                              style={{
                                borderLeftColor: colorForSkill(s.requiredSkillId, skillNameById.get(s.requiredSkillId)),
                                borderLeftWidth: "4px",
                              }}
                              onClick={() => onEditShift?.(s)}
                              title="Edit shift"
                            >
                              <span className="schedule-cal__shift-time">
                                {formatShiftTimeRangeShort(s.startAtUtc, s.endAtUtc, locationTz)}
                              </span>
                              <span className="muted schedule-cal__shift-meta">
                                {skillNameById.get(s.requiredSkillId) ?? "—"} · {openSlots(s)} open
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                );
              })}
            </tr>
            {rosterLoading ? (
              <tr>
                <td colSpan={8} className="schedule-cal__loading">
                  Loading staff roster…
                </td>
              </tr>
            ) : staffRows.length === 0 ? (
              <tr>
                <td colSpan={8} className="schedule-cal__empty-roster">
                  No staff at this location appear on any skill roster yet. Certify people for this location and give them
                  skills (Team), then refresh.
                </td>
              </tr>
            ) : (
              staffRows.map((staff) => (
                <tr key={staff.id} className="schedule-cal__row">
                  <th scope="row" className="schedule-cal__sticky schedule-cal__rowhead schedule-cal__rowhead--person">
                    <div className="schedule-cal__staff-head">
                      <div className="schedule-cal__staff-avatar" aria-hidden>
                        {staffNameInitial(staff.name)}
                      </div>
                      <div className="schedule-cal__staff-text">
                        <span className="schedule-cal__staff-name">{staff.name}</span>
                        {staff.skillIds.size > 0 ? (
                          <ul className="schedule-cal__staff-skills" aria-label="Certified skills">
                            {Array.from(staff.skillIds)
                              .map((skillId) => {
                                const rawName = skillNameById.get(skillId) ?? skillId;
                                return {
                                  skillId,
                                  label: formatSkillDisplayName(rawName),
                                  color: colorForSkill(skillId, rawName),
                                };
                              })
                              .sort((a, b) => a.label.localeCompare(b.label))
                              .map(({ skillId, label, color }) => (
                                <li key={skillId} className="schedule-cal__staff-skill">
                                  <span
                                    className="schedule-cal__staff-skill-dot"
                                    style={{ backgroundColor: color }}
                                    aria-hidden
                                  />
                                  <span className="schedule-cal__staff-skill-label">{label}</span>
                                </li>
                              ))}
                          </ul>
                        ) : null}
                        <span className="schedule-cal__staff-hours">
                          {formatWeekHoursLabel(staffWeekHours.get(staff.id) ?? 0)}
                        </span>
                      </div>
                    </div>
                  </th>
                  {dayMeta.map((d) => {
                    const placed = assignmentsForStaffDay(staff.id, d.ymd);
                    return (
                      <td key={d.ymd} className="schedule-cal__cell">
                        <div className="schedule-cal__cell-inner">
                          {placed.length > 0 ? (
                            <div className="schedule-cal__assigned-cell">
                              <ul className="schedule-cal__assigned">
                                {placed.map(({ shift, assignment }) => (
                                  <li key={assignment.assignmentId} className="schedule-cal__assigned-item">
                                    <div
                                      data-schedule-shift={shift.id}
                                      className={
                                        onRemoveAssignment
                                          ? `schedule-cal__shift-pill schedule-cal__shift-pill--assigned schedule-cal__shift-pill--has-remove${
                                              otAssignmentIds?.has(assignment.assignmentId) ? " schedule-cal__shift-pill--ot" : ""
                                            }${highlightShiftId === shift.id ? " schedule-cal__shift-pill--highlight" : ""}`
                                          : `schedule-cal__shift-pill schedule-cal__shift-pill--assigned${
                                              otAssignmentIds?.has(assignment.assignmentId) ? " schedule-cal__shift-pill--ot" : ""
                                            }${highlightShiftId === shift.id ? " schedule-cal__shift-pill--highlight" : ""}`
                                      }
                                      style={{
                                        borderLeftColor: colorForSkill(
                                          shift.requiredSkillId,
                                          skillNameById.get(shift.requiredSkillId),
                                        ),
                                        borderLeftWidth: "4px",
                                      }}
                                      title={
                                        otAssignmentIds?.has(assignment.assignmentId)
                                          ? "Includes overtime (FIFO after 40h this week at this site)"
                                          : undefined
                                      }
                                    >
                                      <span className="schedule-cal__assigned-pill-text">
                                        {formatShiftTimeRangeShort(shift.startAtUtc, shift.endAtUtc, locationTz)}
                                        <span className="muted">
                                          {" "}
                                          · {skillNameById.get(shift.requiredSkillId) ?? "—"}
                                        </span>
                                      </span>
                                      {onRemoveAssignment ? (
                                        <button
                                          type="button"
                                          className="schedule-cal__assignment-remove"
                                          aria-label="Remove assignment"
                                          title="Remove assignment"
                                          disabled={removeAssignmentPending}
                                          onClick={() => onRemoveAssignment(assignment.assignmentId)}
                                        >
                                          ×
                                        </button>
                                      ) : null}
                                    </div>
                                  </li>
                                ))}
                              </ul>
                              <button
                                type="button"
                                className="schedule-cal__assign-add"
                                onClick={() => onCellAssign(staff, d.ymd)}
                                aria-label="Add another assignment"
                                title="Add another assignment for this day"
                              >
                                <span aria-hidden>+</span>
                              </button>
                            </div>
                          ) : null}
                          {placed.length === 0 ? (
                            <button
                              type="button"
                              className="schedule-cal__add-card schedule-cal__add-card--cell"
                              onClick={() => onCellAssign(staff, d.ymd)}
                            >
                              <span className="schedule-cal__add-card-icon" aria-hidden>
                                +
                              </span>
                              <span>Assign</span>
                            </button>
                          ) : null}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
