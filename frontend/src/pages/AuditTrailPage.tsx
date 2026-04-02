import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { fetchAuditExport, fetchAuditForShift, fetchLocations } from "../api.js";
import { useAuth } from "../context/AuthContext.js";
import type { AuditLogRowDto } from "@shiftsync/shared";

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s.trim());
}

function localDatetimeInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function auditRowsToCsv(rows: AuditLogRowDto[]): string {
  const headers = ["createdAt", "actorName", "entityType", "entityId", "action", "beforeJson", "afterJson"];
  const esc = (s: string): string => `"${s.replace(/"/g, '""')}"`;
  const cell = (v: unknown): string => {
    if (v === null || v === undefined) return '""';
    const raw = typeof v === "object" ? JSON.stringify(v) : String(v);
    return esc(raw);
  };
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(
      [
        esc(r.createdAt),
        esc(r.actorName),
        esc(r.entityType),
        esc(r.entityId),
        esc(r.action),
        cell(r.beforeJson),
        cell(r.afterJson),
      ].join(","),
    );
  }
  return lines.join("\n");
}

function downloadTextFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function JsonBlock({ value }: { value: unknown }): React.ReactElement {
  if (value === null || value === undefined) return <span className="muted">—</span>;
  const text = JSON.stringify(value, null, 2);
  return (
    <pre className="audit-trail__json">
      {text.length > 800 ? `${text.slice(0, 800)}…` : text}
    </pre>
  );
}

export default function AuditTrailPage(): React.ReactElement {
  const { token, user } = useAuth();
  const canManage = user?.role === "ADMIN" || user?.role === "MANAGER";
  const isAdmin = user?.role === "ADMIN";
  const [searchParams] = useSearchParams();
  const qShift = searchParams.get("shiftId");
  const initialShiftId = qShift && isUuid(qShift) ? qShift.trim() : null;

  const [shiftIdInput, setShiftIdInput] = useState(() => initialShiftId ?? "");
  const [activeShiftId, setActiveShiftId] = useState<string | null>(() => initialShiftId);

  const now = useMemo(() => new Date(), []);
  const [exportFrom, setExportFrom] = useState(() => localDatetimeInputValue(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)));
  const [exportTo, setExportTo] = useState(() => localDatetimeInputValue(now));
  const [exportLocationId, setExportLocationId] = useState<string | "">("");
  const [exportRows, setExportRows] = useState<AuditLogRowDto[] | null>(null);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const locationsQuery = useQuery({
    queryKey: ["locations", token],
    queryFn: () => fetchLocations(token!),
    enabled: Boolean(token && isAdmin),
  });

  const shiftAuditQuery = useQuery({
    queryKey: ["audit", "shift", token, activeShiftId],
    queryFn: () => fetchAuditForShift(token!, activeShiftId!),
    enabled: Boolean(token && activeShiftId && isUuid(activeShiftId)),
  });

  const loadShiftAudit = useCallback(() => {
    const t = shiftIdInput.trim();
    if (!isUuid(t)) return;
    setActiveShiftId(t);
  }, [shiftIdInput]);

  const runExport = useCallback(async () => {
    if (!token) return;
    setExportLoading(true);
    setExportError(null);
    try {
      const fromIso = new Date(exportFrom).toISOString();
      const toIso = new Date(exportTo).toISOString();
      if (new Date(fromIso) > new Date(toIso)) {
        throw new Error("“From” must be before “To”.");
      }
      const rows = await fetchAuditExport(token, fromIso, toIso, exportLocationId || undefined);
      setExportRows(rows);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Export failed");
      setExportRows(null);
    } finally {
      setExportLoading(false);
    }
  }, [token, exportFrom, exportTo, exportLocationId]);

  const downloadCsv = useCallback(() => {
    if (!exportRows?.length) return;
    const csv = auditRowsToCsv(exportRows);
    const stamp = DateTime.now().toFormat("yyyy-LL-dd-HHmm");
    downloadTextFile(`audit-export-${stamp}.csv`, csv, "text/csv;charset=utf-8");
  }, [exportRows]);

  const downloadJson = useCallback(() => {
    if (!exportRows?.length) return;
    const stamp = DateTime.now().toFormat("yyyy-LL-dd-HHmm");
    downloadTextFile(
      `audit-export-${stamp}.json`,
      JSON.stringify(exportRows, null, 2),
      "application/json;charset=utf-8",
    );
  }, [exportRows]);

  if (!canManage) {
    return (
      <div className="page">
        <h1 className="page__title">Audit trail</h1>
        <p className="muted">Only managers and admins can view schedule audit history.</p>
      </div>
    );
  }

  return (
    <div className="page audit-trail-page">
      <h1 className="page__title">Audit trail</h1>
      <p className="page__lead muted">
        Schedule changes are logged with who made them, when, and before/after details. Managers can review a single
        shift; admins can export by date range and location.
      </p>

      <section className="card stack audit-trail__section">
        <h2 className="card__title">Shift history</h2>
        <p className="muted audit-trail__hint">
          Paste a shift ID (from the schedule or shift URL) to see every logged change for that shift and its week at
          that location.
        </p>
        <div className="audit-trail__shift-row">
          <label className="field audit-trail__shift-field">
            <span className="field__label">Shift ID</span>
            <input
              className="mono"
              value={shiftIdInput}
              onChange={(e) => setShiftIdInput(e.target.value)}
              placeholder="e.g. 8f2c1b4a-…"
              spellCheck={false}
              onKeyDown={(e) => {
                if (e.key === "Enter") loadShiftAudit();
              }}
            />
          </label>
          <button type="button" className="btn btn--primary" disabled={!isUuid(shiftIdInput.trim())} onClick={loadShiftAudit}>
            Load history
          </button>
        </div>

        {shiftAuditQuery.isLoading ? <p className="muted">Loading…</p> : null}
        {shiftAuditQuery.isError ? (
          <p className="text-error">
            {(shiftAuditQuery.error as Error).message === "SHIFT_AUDIT_NOT_FOUND"
              ? "Shift not found, or you don’t have access to that location."
              : (shiftAuditQuery.error as Error).message}
          </p>
        ) : null}
        {shiftAuditQuery.data && shiftAuditQuery.data.length === 0 ? (
          <p className="muted">No audit entries yet for this shift.</p>
        ) : null}
        {shiftAuditQuery.data && shiftAuditQuery.data.length > 0 ? (
          <div className="table-wrap audit-trail__table-wrap">
            <table className="table audit-trail__table">
              <thead>
                <tr>
                  <th>When (UTC)</th>
                  <th>Who</th>
                  <th>Entity</th>
                  <th>Action</th>
                  <th>Before</th>
                  <th>After</th>
                </tr>
              </thead>
              <tbody>
                {shiftAuditQuery.data.map((row) => (
                  <tr key={row.id}>
                    <td className="mono audit-trail__when">{row.createdAt}</td>
                    <td>{row.actorName}</td>
                    <td>
                      <span className="audit-trail__entity">{row.entityType}</span>
                      <span className="mono audit-trail__entity-id">{row.entityId}</span>
                    </td>
                    <td>
                      <span className="audit-trail__action">{row.action}</span>
                    </td>
                    <td>
                      <JsonBlock value={row.beforeJson} />
                    </td>
                    <td>
                      <JsonBlock value={row.afterJson} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {isAdmin ? (
        <section className="card stack audit-trail__section">
          <h2 className="card__title">Export (admin)</h2>
          <p className="muted audit-trail__hint">
            Pull up to 5,000 rows for the window you choose. Optional location filter limits to shifts, assignments, and
            week publish/unpublish events for that site.
          </p>
          <div className="audit-trail__export-grid">
            <label className="field">
              <span className="field__label">From</span>
              <input type="datetime-local" value={exportFrom} onChange={(e) => setExportFrom(e.target.value)} />
            </label>
            <label className="field">
              <span className="field__label">To</span>
              <input type="datetime-local" value={exportTo} onChange={(e) => setExportTo(e.target.value)} />
            </label>
            <label className="field">
              <span className="field__label">Location (optional)</span>
              <select value={exportLocationId} onChange={(e) => setExportLocationId(e.target.value)}>
                <option value="">All locations</option>
                {(locationsQuery.data ?? []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="audit-trail__export-actions">
            <button type="button" className="btn btn--primary" disabled={exportLoading} onClick={() => void runExport()}>
              {exportLoading ? "…" : "Run export"}
            </button>
            {exportRows && exportRows.length > 0 ? (
              <>
                <button type="button" className="btn btn--secondary" onClick={downloadCsv}>
                  Download CSV
                </button>
                <button type="button" className="btn btn--secondary" onClick={downloadJson}>
                  Download JSON
                </button>
                <span className="muted audit-trail__export-count">{exportRows.length} rows</span>
              </>
            ) : null}
          </div>
          {exportError ? <p className="text-error">{exportError}</p> : null}
          {exportRows && exportRows.length === 0 ? <p className="muted">No rows in this range (and filters).</p> : null}
          {exportRows && exportRows.length > 0 ? (
            <div className="table-wrap audit-trail__table-wrap">
              <table className="table audit-trail__table">
                <thead>
                  <tr>
                    <th>When (UTC)</th>
                    <th>Who</th>
                    <th>Entity</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {exportRows.slice(0, 80).map((row) => (
                    <tr key={row.id}>
                      <td className="mono">{row.createdAt}</td>
                      <td>{row.actorName}</td>
                      <td>
                        <span className="audit-trail__entity">{row.entityType}</span>
                        <span className="mono audit-trail__entity-id">{row.entityId}</span>
                      </td>
                      <td>{row.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {exportRows.length > 80 ? (
                <p className="muted audit-trail__preview-note">Preview shows first 80 rows. Download CSV or JSON for the full set.</p>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
