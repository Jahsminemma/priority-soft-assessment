import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { fetchAuditExport, fetchAuditList, fetchLocations } from "../api.js";
import { useAuth } from "../context/AuthContext.js";
import type { AuditLogRowDto } from "@shiftsync/shared";

// ─── helpers ────────────────────────────────────────────────────────────────

function localDatetimeInputValue(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

const ROLE_BADGE: Record<string, string> = {
  ADMIN: "audit-page__role audit-page__role--admin",
  MANAGER: "audit-page__role audit-page__role--manager",
  STAFF: "audit-page__role audit-page__role--staff",
  SYSTEM: "audit-page__role audit-page__role--system",
};

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Admin", MANAGER: "Manager", STAFF: "Staff", SYSTEM: "System",
};

const ACTION_COLOR: Record<string, string> = {
  CREATE: "green", UPDATE: "blue", DELETE: "red",
  PUBLISH: "purple", UNPUBLISH: "orange",
  ACCEPT: "green", APPROVE: "green", CANCEL: "red", CLAIM: "green", EXPIRE: "orange",
};

const ENTITY_LABEL: Record<string, string> = {
  Shift: "Shift", ShiftAssignment: "Assignment",
  ScheduleWeek: "Schedule Week", CoverageRequest: "Coverage",
};

const ACTION_LABEL: Record<string, string> = {
  "Shift:CREATE": "Created shift",
  "Shift:UPDATE": "Edited shift",
  "Shift:DELETE": "Deleted shift",
  "ShiftAssignment:CREATE": "Staff assigned",
  "ShiftAssignment:DELETE": "Staff unassigned",
  "ScheduleWeek:PUBLISH": "Schedule published",
  "ScheduleWeek:UNPUBLISH": "Schedule unpublished",
  "CoverageRequest:CREATE": "Coverage requested",
  "CoverageRequest:ACCEPT": "Swap accepted",
  "CoverageRequest:APPROVE": "Swap approved",
  "CoverageRequest:CANCEL": "Coverage cancelled",
  "CoverageRequest:CLAIM": "Open shift claimed",
  "CoverageRequest:EXPIRE": "Coverage expired",
};

const FIELD_LABELS: Record<string, string> = {
  startAtUtc: "Start time", endAtUtc: "End time", headcount: "Headcount",
  status: "Status", isPremium: "Premium", staffUserId: "Staff",
  emergencyOverrideReason: "Emergency reason", seventhDayOverrideReason: "7th-day override",
  cutoffHours: "Edit cutoff",
};

function formatVal(key: string, val: unknown): string {
  if (val === null || val === undefined) return "—";
  if (key.includes("AtUtc") || key.includes("At")) {
    const dt = DateTime.fromISO(String(val), { zone: "utc" });
    return dt.isValid ? dt.toLocal().toFormat("EEE d MMM · h:mm a") : String(val);
  }
  if (key === "isPremium") return val ? "Yes" : "No";
  if (key === "status") return String(val);
  if (typeof val === "string" && val.length > 120) return `${val.slice(0, 120)}…`;
  return String(val);
}

type DiffEntry = { label: string; before: string; after: string };

function computeDiff(before: unknown, after: unknown): DiffEntry[] {
  const b = (before && typeof before === "object" ? before : {}) as Record<string, unknown>;
  const a = (after && typeof after === "object" ? after : {}) as Record<string, unknown>;
  const SKIP = new Set(["id", "weekKey", "createdAt", "createdById", "locationId", "requiredSkillId", "shiftId"]);
  const out: DiffEntry[] = [];
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  for (const k of keys) {
    if (SKIP.has(k)) continue;
    const bv = formatVal(k, b[k]);
    const av = formatVal(k, a[k]);
    if (bv !== av) out.push({ label: FIELD_LABELS[k] ?? k, before: bv, after: av });
  }
  return out;
}

function relativeTime(iso: string): string {
  const dt = DateTime.fromISO(iso);
  if (!dt.isValid) return iso;
  const abs = dt.toLocal().toFormat("dd MMM yyyy · h:mm a");
  const rel = dt.toRelative({ style: "short" });
  return `${abs}${rel ? ` (${rel})` : ""}`;
}

// ─── row expandable component ───────────────────────────────────────────────

function AuditRow({ row }: { row: AuditLogRowDto }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const actionKey = `${row.entityType}:${row.action}`;
  const label = ACTION_LABEL[actionKey] ?? `${row.entityType} ${row.action}`;
  const color = ACTION_COLOR[row.action] ?? "muted";
  const diffs = useMemo(() => computeDiff(row.beforeJson, row.afterJson), [row.beforeJson, row.afterJson]);
  const when = relativeTime(row.createdAt);

  return (
    <>
      <tr
        className={`audit-page__row audit-page__row--${color}${open ? " audit-page__row--open" : ""}`}
        onClick={() => setOpen((o) => !o)}
        style={{ cursor: "pointer" }}
      >
        <td className="audit-page__td--when mono">{when}</td>
        <td>
          <span className={ROLE_BADGE[row.actorRole] ?? "audit-page__role audit-page__role--system"}>
            {ROLE_LABEL[row.actorRole] ?? row.actorRole}
          </span>
          <span className="audit-page__actor-name">{row.actorName}</span>
        </td>
        <td>
          <span className={`audit-page__action-label audit-page__action--${color}`}>{label}</span>
        </td>
        <td className="audit-page__td--entity">
          <span className="audit-page__entity-type">{ENTITY_LABEL[row.entityType] ?? row.entityType}</span>
        </td>
        <td className="audit-page__td--location">
          {row.locationName ? (
            <span className="audit-page__location-badge">{row.locationName}</span>
          ) : (
            <span className="muted">—</span>
          )}
        </td>
        <td className="audit-page__td--expand" aria-label={open ? "Collapse" : "Expand"}>
          <span className="audit-page__chevron">{open ? "▲" : "▼"}</span>
        </td>
      </tr>
      {open ? (
        <tr className="audit-page__detail-row">
          <td colSpan={6} className="audit-page__detail-cell">
            <div className="audit-page__detail">
              {diffs.length > 0 ? (
                <div className="audit-page__diff-grid">
                  <div className="audit-page__diff-col audit-page__diff-col--label">Field</div>
                  <div className="audit-page__diff-col audit-page__diff-col--before">Before</div>
                  <div className="audit-page__diff-col audit-page__diff-col--after">After</div>
                  {diffs.map((d) => (
                    <>
                      <div key={`${d.label}-l`} className="audit-page__diff-field">{d.label}</div>
                      <div key={`${d.label}-b`} className="audit-page__diff-before">{d.before}</div>
                      <div key={`${d.label}-a`} className="audit-page__diff-after">{d.after}</div>
                    </>
                  ))}
                </div>
              ) : null}

              {diffs.length === 0 && row.afterJson && typeof row.afterJson === "object" ? (
                <div className="audit-page__diff-grid">
                  <div className="audit-page__diff-col audit-page__diff-col--label">Field</div>
                  <div className="audit-page__diff-col audit-page__diff-col--after" style={{ gridColumn: "2 / span 2" }}>Value</div>
                  {Object.entries(row.afterJson as Record<string, unknown>)
                    .filter(([k]) => !["id", "shiftId", "locationId"].includes(k))
                    .slice(0, 8)
                    .map(([k, v]) => (
                      <>
                        <div key={`${k}-l`} className="audit-page__diff-field">{FIELD_LABELS[k] ?? k}</div>
                        <div key={`${k}-a`} className="audit-page__diff-after" style={{ gridColumn: "2 / span 2" }}>
                          {formatVal(k, v)}
                        </div>
                      </>
                    ))}
                </div>
              ) : null}

              <p className="audit-page__detail-id muted mono">
                id: {row.entityId}
              </p>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

// ─── csv / json export ───────────────────────────────────────────────────────

function auditRowsToCsv(rows: AuditLogRowDto[]): string {
  const headers = ["createdAt", "actorName", "actorRole", "locationName", "entityType", "entityId", "action", "beforeJson", "afterJson"];
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const cell = (v: unknown) => (v === null || v === undefined ? '""' : esc(typeof v === "object" ? JSON.stringify(v) : String(v)));
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push([esc(r.createdAt), esc(r.actorName), esc(r.actorRole), cell(r.locationName), esc(r.entityType), esc(r.entityId), esc(r.action), cell(r.beforeJson), cell(r.afterJson)].join(","));
  }
  return lines.join("\n");
}

function downloadFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ─── page ────────────────────────────────────────────────────────────────────

const ENTITY_TYPES = ["All", "Shift", "ShiftAssignment", "ScheduleWeek", "CoverageRequest"];

export default function AuditTrailPage(): React.ReactElement {
  const { token, user } = useAuth();
  const isAdmin = user?.role === "ADMIN";

  const now = useMemo(() => new Date(), []);
  const [from, setFrom] = useState(() => localDatetimeInputValue(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)));
  const [to, setTo] = useState(() => localDatetimeInputValue(now));
  const [locationId, setLocationId] = useState("");
  const [entityFilter, setEntityFilter] = useState("All");
  const [actionSearch, setActionSearch] = useState("");
  const [actorSearch, setActorSearch] = useState("");

  const [exportLoading, setExportLoading] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const locationsQuery = useQuery({
    queryKey: ["locations", token],
    queryFn: () => fetchLocations(token!),
    enabled: Boolean(token && isAdmin),
  });

  const auditQuery = useQuery({
    queryKey: ["audit", "list", token, from, to, locationId],
    queryFn: () =>
      fetchAuditList(token!, {
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString(),
        locationId: locationId || undefined,
      }),
    enabled: Boolean(token && isAdmin),
    staleTime: 30_000,
  });

  const filteredRows = useMemo(() => {
    const rows = auditQuery.data ?? [];
    return rows.filter((r) => {
      if (entityFilter !== "All" && r.entityType !== entityFilter) return false;
      if (actionSearch && !`${r.action} ${r.entityType}`.toLowerCase().includes(actionSearch.toLowerCase())) return false;
      if (actorSearch && !r.actorName.toLowerCase().includes(actorSearch.toLowerCase())) return false;
      return true;
    });
  }, [auditQuery.data, entityFilter, actionSearch, actorSearch]);

  const runExport = useCallback(async () => {
    if (!token) return;
    setExportLoading(true);
    setExportError(null);
    try {
      const fromIso = new Date(from).toISOString();
      const toIso = new Date(to).toISOString();
      if (new Date(fromIso) > new Date(toIso)) throw new Error("From must be before To.");
      const rows = await fetchAuditExport(token, fromIso, toIso, locationId || undefined);
      const stamp = DateTime.now().toFormat("yyyy-LL-dd-HHmm");
      downloadFile(`audit-export-${stamp}.csv`, auditRowsToCsv(rows), "text/csv;charset=utf-8");
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExportLoading(false);
    }
  }, [token, from, to, locationId]);

  if (!isAdmin) {
    return (
      <div className="page">
        <h1 className="page__title">Audit trail</h1>
        <p className="muted">Only administrators can view global audit logs. Managers can open a shift’s History tab on the schedule.</p>
      </div>
    );
  }

  return (
    <div className="page audit-page">
      <div className="audit-page__header">
        <div>
          <h1 className="page__title">Audit trail</h1>
          <p className="page__lead muted">
            Every schedule change: who made it, when, and what changed. Click any row to see before → after details.
          </p>
        </div>
        {isAdmin ? (
          <button type="button" className="btn btn--secondary audit-page__export-btn" disabled={exportLoading} onClick={() => void runExport()}>
            {exportLoading ? "…" : "Export CSV"}
          </button>
        ) : null}
      </div>
      {exportError ? <p className="text-error">{exportError}</p> : null}

      {/* ── filters ── */}
      <div className="card audit-page__filters">
        <div className="audit-page__filter-row">
          <label className="field audit-page__filter-field">
            <span className="field__label">From</span>
            <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="field audit-page__filter-field">
            <span className="field__label">To</span>
            <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label className="field audit-page__filter-field">
            <span className="field__label">Location</span>
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">{isAdmin ? "All locations" : "All my locations"}</option>
              {(locationsQuery.data ?? []).map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </label>
          <label className="field audit-page__filter-field">
            <span className="field__label">Entity type</span>
            <select value={entityFilter} onChange={(e) => setEntityFilter(e.target.value)}>
              {ENTITY_TYPES.map((t) => <option key={t} value={t}>{ENTITY_LABEL[t] ?? t}</option>)}
            </select>
          </label>
          <label className="field audit-page__filter-field">
            <span className="field__label">Actor</span>
            <input placeholder="Search name…" value={actorSearch} onChange={(e) => setActorSearch(e.target.value)} />
          </label>
        </div>
      </div>

      {/* ── table ── */}
      <div className="card audit-page__table-card">
        <div className="audit-page__table-meta">
          {auditQuery.isLoading ? (
            <span className="muted">Loading…</span>
          ) : (
            <span className="muted">{filteredRows.length} event{filteredRows.length !== 1 ? "s" : ""}</span>
          )}
        </div>
        {auditQuery.isError ? (
          <p className="text-error">Could not load audit logs.</p>
        ) : null}

        {!auditQuery.isLoading && filteredRows.length === 0 && auditQuery.isSuccess ? (
          <p className="muted audit-page__empty">No audit events in this range{entityFilter !== "All" ? ` for entity type "${entityFilter}"` : ""}.</p>
        ) : null}

        {filteredRows.length > 0 ? (
          <div className="table-wrap audit-page__table-wrap">
            <table className="table audit-page__table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Actor</th>
                  <th>Event</th>
                  <th>Type</th>
                  <th>Location</th>
                  <th aria-label="Details" />
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <AuditRow key={row.id} row={row} />
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
}
