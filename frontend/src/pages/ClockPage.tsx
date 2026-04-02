import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { fetchLocations, fetchMyClockSessions, fetchOnDutyForLocation } from "../api.js";
import { useAuth } from "../context/AuthContext.js";

function formatClockInstant(isoUtc: string, tzIana: string | null): string {
  const z = tzIana && tzIana.length > 0 ? tzIana : "UTC";
  const dt = DateTime.fromISO(isoUtc, { zone: "utc" }).setZone(z);
  if (!dt.isValid) return isoUtc;
  return dt.toFormat("MMM d, yyyy · h:mm a");
}

export default function ClockPage(): React.ReactElement {
  const { token, user } = useAuth();
  const queryClient = useQueryClient();
  const isStaff = user?.role === "STAFF";
  const canSeeOnDuty = user?.role === "ADMIN" || user?.role === "MANAGER";

  const [onDutyLocationId, setOnDutyLocationId] = useState("");

  const locationsQuery = useQuery({
    queryKey: ["locations", token],
    queryFn: () => fetchLocations(token!),
    enabled: Boolean(token),
  });

  const historyQuery = useQuery({
    queryKey: ["clock", "my-sessions", token],
    queryFn: () => fetchMyClockSessions(token!),
    enabled: Boolean(token && isStaff),
    staleTime: 30_000,
  });

  const onDutyQuery = useQuery({
    queryKey: ["onDuty", token, onDutyLocationId],
    queryFn: () => fetchOnDutyForLocation(token!, onDutyLocationId),
    enabled: Boolean(token && onDutyLocationId && canSeeOnDuty),
  });

  const locs = locationsQuery.data ?? [];

  useEffect(() => {
    if (!locs.length || onDutyLocationId || !canSeeOnDuty) return;
    setOnDutyLocationId(locs[0]!.id);
  }, [locs, onDutyLocationId, canSeeOnDuty]);

  const historyRows = historyQuery.data ?? [];

  const pageTitle = isStaff ? "Work history" : "Clock & on-duty";

  return (
    <div className="page">
      <h1 className="page__title">{pageTitle}</h1>
      <p className="page__lead muted">
        {isStaff ? (
          <>
            Shifts where you clocked in (in and out times). Get a verification code from your{" "}
            <strong>dashboard</strong> when you arrive — your manager enters it to confirm your punch.
          </>
        ) : (
          <>
            <strong>Managers:</strong> see who’s on site at each location. Tap <strong>Refresh list</strong> if the
            table looks out of date.
          </>
        )}
      </p>

      {isStaff ? (
        <div className="card stack work-history-card">
          <h2 className="card__title">Clocked sessions</h2>
          {historyQuery.isLoading ? <p className="muted">Loading…</p> : null}
          {historyQuery.isError ? <p className="text-error">Could not load work history.</p> : null}
          {!historyQuery.isLoading && !historyQuery.isError && historyRows.length === 0 ? (
            <p className="muted">No clocked shifts yet. After your manager confirms your clock-in, your sessions appear here.</p>
          ) : null}
          {!historyQuery.isLoading && historyRows.length > 0 ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Location</th>
                    <th>Clocked in</th>
                    <th>Clocked out</th>
                  </tr>
                </thead>
                <tbody>
                  {historyRows.map((row) => (
                    <tr key={row.sessionId}>
                      <td>{row.locationName ?? "—"}</td>
                      <td className="mono">{formatClockInstant(row.clockInAtUtc, row.tzIana)}</td>
                      <td className="mono">
                        {row.clockOutAtUtc ? formatClockInstant(row.clockOutAtUtc, row.tzIana) : "Still on shift"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="card muted">
          <p>Work history is available when you sign in with a staff account.</p>
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
