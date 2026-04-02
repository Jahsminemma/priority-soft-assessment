import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import {
  approveClockInCode,
  fetchLocations,
  fetchMyClockSessions,
  fetchOnDutyForLocation,
  previewClockInCode,
} from "../api.js";
import { useAuth } from "../context/AuthContext.js";
import type { ClockCodePreviewResponse } from "@shiftsync/shared";
import {
  formatFullCalendarDateInZone,
  formatShiftDurationHuman,
  formatShiftWallTimeArrow,
} from "../utils/scheduleTime.js";

function formatClockInstant(isoUtc: string, tzIana: string | null): string {
  const z = tzIana && tzIana.length > 0 ? tzIana : "UTC";
  const dt = DateTime.fromISO(isoUtc, { zone: "utc" }).setZone(z);
  if (!dt.isValid) return isoUtc;
  return dt.toFormat("MMM d, yyyy · h:mm a");
}

function staffInitials(name: string): string {
  const p = name.trim().split(/\s+/).slice(0, 2);
  return p.map((x) => x[0]?.toUpperCase() ?? "").join("") || "?";
}

function normalizeCodeInput(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 6);
}

function friendlyClockError(msg: string, context: "lookup" | "approve"): string {
  const lookup: Record<string, string> = {
    INVALID_CODE: "Enter exactly six digits.",
    CODE_NOT_FOUND: "No active code matches that number.",
    CODE_EXPIRED: "That code has expired. Ask them to tap Clock in again for a new code.",
    CODE_ALREADY_USED: "That code was already used.",
  };
  const approve: Record<string, string> = {
    ...lookup,
    NOT_ASSIGNED_TO_SHIFT: "They’re no longer assigned to that shift.",
    SHIFT_ENDED: "That shift has already ended.",
    ALREADY_CLOCKED_IN: "They’re already clocked in.",
  };
  const map = context === "lookup" ? lookup : approve;
  return map[msg] ?? msg;
}

export default function ClockPage(): React.ReactElement {
  const { token, user } = useAuth();
  const queryClient = useQueryClient();
  const isStaff = user?.role === "STAFF";
  const canSeeOnDuty = user?.role === "ADMIN" || user?.role === "MANAGER";

  const [onDutyLocationId, setOnDutyLocationId] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [preview, setPreview] = useState<ClockCodePreviewResponse | null>(null);
  const [previewCode, setPreviewCode] = useState<string | null>(null);

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
  const selectedLoc = useMemo(() => locs.find((l) => l.id === onDutyLocationId), [locs, onDutyLocationId]);

  useEffect(() => {
    if (!locs.length || onDutyLocationId || !canSeeOnDuty) return;
    setOnDutyLocationId(locs[0]!.id);
  }, [locs, onDutyLocationId, canSeeOnDuty]);

  const historyRows = historyQuery.data ?? [];

  const previewMut = useMutation({
    mutationFn: () => previewClockInCode(token!, normalizeCodeInput(codeInput)),
    onSuccess: (data) => {
      setPreview(data);
      setPreviewCode(normalizeCodeInput(codeInput));
    },
    onError: () => {
      setPreview(null);
      setPreviewCode(null);
    },
  });

  const approveMut = useMutation({
    mutationFn: () => approveClockInCode(token!, previewCode ?? normalizeCodeInput(codeInput)),
    onSuccess: () => {
      setPreview(null);
      setPreviewCode(null);
      setCodeInput("");
      void queryClient.invalidateQueries({ queryKey: ["onDuty"] });
    },
  });

  useEffect(() => {
    const norm = normalizeCodeInput(codeInput);
    if (preview && previewCode && norm !== previewCode) {
      setPreview(null);
      setPreviewCode(null);
    }
  }, [codeInput, preview, previewCode]);

  const pageTitle = isStaff ? "Work history" : "Clock & on-duty";

  return (
    <div className="page clock-page">
      <h1 className="page__title">{pageTitle}</h1>
      <p className="page__lead muted">
        {isStaff ? (
          <>
            Shifts where you clocked in (in and out times). Get a verification code from your{" "}
            <strong>dashboard</strong> when you arrive — your manager enters it here to confirm your punch.
          </>
        ) : (
          <>
            <strong>Verify clock-in:</strong> enter the six-digit code from a staff member, review their details, then
            approve. <strong>On-duty:</strong> pick a location to see who is currently clocked in there.
          </>
        )}
      </p>

      {isStaff ? (
        <div className="card stack work-history-card">
          <h2 className="card__title">Clocked sessions</h2>
          {historyQuery.isLoading ? <p className="muted">Loading…</p> : null}
          {historyQuery.isError ? <p className="text-error">Could not load work history.</p> : null}
          {!historyQuery.isLoading && !historyQuery.isError && historyRows.length === 0 ? (
            <p className="muted">
              No clocked shifts yet. After your manager confirms your clock-in, your sessions appear here.
            </p>
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
        <div className="manager-clock-layout">
          <section className="manager-clock-verify card">
            <div className="manager-clock-verify__head">
              <h2 className="card__title">Verify clock-in</h2>
              <p className="manager-clock-verify__head-lead muted">
                Staff tap <strong>Clock in</strong> on their dashboard to get a code — they read it to you.
              </p>
            </div>
            <div className="manager-clock-verify__input-row">
              <label className="manager-clock-verify__label" htmlFor="clock-code-input">
                Six-digit code
              </label>
              <div className="manager-clock-verify__input-wrap">
                <input
                  id="clock-code-input"
                  className="manager-clock-verify__input mono"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="000000"
                  maxLength={9}
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void previewMut.mutateAsync();
                  }}
                />
                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={normalizeCodeInput(codeInput).length !== 6 || previewMut.isPending}
                  onClick={() => void previewMut.mutateAsync()}
                >
                  {previewMut.isPending ? "…" : "Look up"}
                </button>
              </div>
            </div>
            {previewMut.isError ? (
              <p className="manager-clock-verify__err text-error">
                {friendlyClockError((previewMut.error as Error).message, "lookup")}
              </p>
            ) : null}

            {preview && previewCode ? (
              <div className="manager-clock-verify__result">
                {selectedLoc && preview.shiftLocationId !== selectedLoc.id ? (
                  <div className="manager-clock-verify__info" role="status">
                    <span className="manager-clock-verify__info-icon" aria-hidden>
                      ℹ
                    </span>
                    <span>
                      The on-duty list is filtered for <strong>{selectedLoc.name}</strong>. This shift is at{" "}
                      <strong>{preview.location.name}</strong> — switch the location filter if you want to see who’s on
                      site there.
                    </span>
                  </div>
                ) : null}

                {preview.managerLocationWarning ? (
                  <div className="manager-clock-verify__warn" role="banner">
                    <span className="manager-clock-verify__warn-icon" aria-hidden>
                      ⚠
                    </span>
                    <p>{preview.managerLocationWarning}</p>
                  </div>
                ) : null}

                <div className="manager-clock-staff-card">
                  <div className="manager-clock-staff-card__avatar" aria-hidden>
                    {staffInitials(preview.staff.name)}
                  </div>
                  <div className="manager-clock-staff-card__body">
                    <p className="manager-clock-staff-card__name">{preview.staff.name}</p>
                    <p className="manager-clock-staff-card__email mono">{preview.staff.email}</p>
                    <div className="manager-clock-staff-card__badges">
                      <span className="manager-clock-badge">{preview.location.name}</span>
                      <span className="manager-clock-badge manager-clock-badge--muted">{preview.skillName}</span>
                    </div>
                    <p className="manager-clock-staff-card__shift">
                      {formatShiftWallTimeArrow(preview.shift.startAtUtc, preview.shift.endAtUtc, preview.location.tzIana)}
                    </p>
                    <p className="manager-clock-staff-card__date muted">
                      {formatFullCalendarDateInZone(preview.shift.startAtUtc, preview.location.tzIana)} ·{" "}
                      {formatShiftDurationHuman(preview.shift.startAtUtc, preview.shift.endAtUtc)}
                    </p>
                    <p className="manager-clock-staff-card__exp muted">
                      Code expires{" "}
                      {DateTime.fromISO(preview.expiresAtUtc, { zone: "utc" }).toLocal().toFormat("h:mm a")} local time
                    </p>
                  </div>
                </div>

                <div className="manager-clock-verify__approve">
                  <button
                    type="button"
                    className="btn btn--primary"
                    disabled={approveMut.isPending}
                    onClick={() => void approveMut.mutateAsync()}
                  >
                    {approveMut.isPending ? "…" : "Approve & clock in"}
                  </button>
                  {approveMut.isError ? (
                    <p className="text-error manager-clock-verify__approve-err">
                      {friendlyClockError((approveMut.error as Error).message, "approve")}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </section>

          <section className="manager-clock-onduty card stack">
            <h2 className="card__title">Who’s on duty</h2>
            <p className="manager-clock-onduty__hint muted">
              This list only shows people clocked in at the site you select below — not where you’re physically standing.
              Code verification is separate from this filter.
            </p>
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
              <table className="table manager-clock-onduty__table">
                <thead>
                  <tr>
                    <th>Staff</th>
                    <th>Clocked in</th>
                    <th>Shift window</th>
                  </tr>
                </thead>
                <tbody>
                  {(onDutyQuery.data ?? []).map((r) => (
                    <tr key={r.sessionId}>
                      <td>
                        <span className="manager-clock-onduty__name">{r.staffName}</span>
                      </td>
                      <td className="mono">{formatClockInstant(r.clockInAtUtc, selectedLoc?.tzIana ?? null)}</td>
                      <td className="mono manager-clock-onduty__shift">
                        {r.shiftStartAtUtc && r.shiftEndAtUtc && selectedLoc
                          ? formatShiftWallTimeArrow(r.shiftStartAtUtc, r.shiftEndAtUtc, selectedLoc.tzIana)
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(onDutyQuery.data ?? []).length === 0 && onDutyQuery.isSuccess ? (
              <p className="muted">No one is clocked in at this location right now.</p>
            ) : null}
          </section>
        </div>
      ) : (
        <div className="card muted">
          <p>Only managers and admins can see who’s on duty across locations.</p>
        </div>
      )}
    </div>
  );
}
