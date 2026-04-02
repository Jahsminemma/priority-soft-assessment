import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  clockIn,
  clockOut,
  fetchLocations,
  fetchOnDutyForLocation,
  fetchShiftsStaff,
} from "../api.js";
import { useAuth } from "../context/AuthContext.js";
import { WeekPicker } from "../components/WeekPicker.js";
import { formatShiftRangeLabel } from "../utils/scheduleTime.js";
import { initialWeekKeyFromToday } from "../utils/weekKey.js";
import { normalizeIsoWeekKey } from "@shiftsync/shared";

export default function ClockPage(): React.ReactElement {
  const { token, user } = useAuth();
  const queryClient = useQueryClient();
  const isStaff = user?.role === "STAFF";
  const canSeeOnDuty = user?.role === "ADMIN" || user?.role === "MANAGER";

  const [weekKey, setWeekKey] = useState(() => normalizeIsoWeekKey(initialWeekKeyFromToday()));
  const [shiftId, setShiftId] = useState("");
  const [onDutyLocationId, setOnDutyLocationId] = useState("");

  const locationsQuery = useQuery({
    queryKey: ["locations", token],
    queryFn: () => fetchLocations(token!),
    enabled: Boolean(token),
  });

  const weekKeyNorm = normalizeIsoWeekKey(weekKey);
  const staffShiftsQuery = useQuery({
    queryKey: ["shifts", "staff", token, weekKeyNorm],
    queryFn: ({ signal }) => fetchShiftsStaff(token!, weekKey, signal),
    enabled: Boolean(token && isStaff && weekKey),
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    structuralSharing: false,
  });

  const onDutyQuery = useQuery({
    queryKey: ["onDuty", token, onDutyLocationId],
    queryFn: () => fetchOnDutyForLocation(token!, onDutyLocationId),
    enabled: Boolean(token && onDutyLocationId && canSeeOnDuty),
  });

  const clockInMut = useMutation({
    mutationFn: () => clockIn(token!, shiftId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["onDuty"] });
    },
  });

  const clockOutMut = useMutation({
    mutationFn: () => clockOut(token!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["onDuty"] });
    },
  });

  const locs = locationsQuery.data ?? [];
  const staffShifts = staffShiftsQuery.data ?? [];
  const locById = useMemo(() => new Map(locs.map((l) => [l.id, l])), [locs]);

  useEffect(() => {
    if (!locs.length || onDutyLocationId || !canSeeOnDuty) return;
    setOnDutyLocationId(locs[0]!.id);
  }, [locs, onDutyLocationId, canSeeOnDuty]);

  useEffect(() => {
    if (!staffShifts.length || shiftId || !isStaff) return;
    setShiftId(staffShifts[0]!.id);
  }, [staffShifts, shiftId, isStaff]);

  return (
    <div className="page">
      <h1 className="page__title">Clock & on-duty</h1>
      <p className="page__lead muted">
        <strong>Staff:</strong> clock in when you start and clock out when you finish. <strong>Managers:</strong> see who’s
        on site at each location. Tap <strong>Refresh list</strong> if the table looks out of date.
      </p>

      {isStaff ? (
        <div className="card stack staff-clock-card">
          <h2 className="card__title">Your time clock</h2>
          <WeekPicker weekKey={weekKey} onWeekKeyChange={setWeekKey} id="clock-week" compact />
          <label className="field">
            <span className="field__label">Shift you’re working</span>
            <select value={shiftId} onChange={(e) => setShiftId(e.target.value)}>
              {staffShifts.map((s) => {
                const loc = locById.get(s.locationId);
                const label = loc
                  ? `${loc.name} · ${formatShiftRangeLabel(s.startAtUtc, s.endAtUtc, loc.tzIana)}`
                  : `${s.id.slice(0, 8)}…`;
                return (
                  <option key={s.id} value={s.id}>
                    {label}
                  </option>
                );
              })}
            </select>
          </label>
          <div className="staff-clock-card__actions">
            <button
              type="button"
              className="btn btn--primary"
              disabled={!shiftId || clockInMut.isPending}
              onClick={() => void clockInMut.mutateAsync()}
            >
              {clockInMut.isPending ? "…" : "Clock in"}
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              disabled={clockOutMut.isPending}
              onClick={() => void clockOutMut.mutateAsync()}
            >
              {clockOutMut.isPending ? "…" : "Clock out"}
            </button>
          </div>
          {clockInMut.isError ? <p className="text-error">{(clockInMut.error as Error).message}</p> : null}
          {clockOutMut.isError ? <p className="text-error">{(clockOutMut.error as Error).message}</p> : null}
        </div>
      ) : (
        <div className="card muted">
          <p>Clock in and out is for staff accounts. Sign in with a staff profile to use this section.</p>
        </div>
      )}

      {canSeeOnDuty ? (
        <div className="card stack">
          <h2 className="card__title">Who’s on duty</h2>
          <label className="field">
            <span className="field__label">Location</span>
            <select value={onDutyLocationId} onChange={(e) => setOnDutyLocationId(e.target.value)}>
              {locs.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => void queryClient.invalidateQueries({ queryKey: ["onDuty"] })}
          >
            Refresh list
          </button>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Staff</th>
                  <th>Clocked in at</th>
                  <th>Shift</th>
                </tr>
              </thead>
              <tbody>
                {(onDutyQuery.data ?? []).map((r) => (
                  <tr key={r.sessionId}>
                    <td>{r.staffName}</td>
                    <td className="mono">{r.clockInAtUtc}</td>
                    <td className="mono">{r.shiftId ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(onDutyQuery.data ?? []).length === 0 && onDutyQuery.isSuccess ? (
            <p className="muted">No one is clocked in at this location right now.</p>
          ) : null}
        </div>
      ) : (
        <div className="card muted">
          <p>Only managers and admins can see who’s on duty across locations.</p>
        </div>
      )}
    </div>
  );
}
