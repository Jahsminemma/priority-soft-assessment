import { useQuery } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { fetchAuditForShift } from "../api.js";
import { useAuth } from "../context/AuthContext.js";
import type { AuditLogRowDto } from "@shiftsync/shared";

// ─── human-readable helpers ────────────────────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  startAtUtc: "Start time",
  endAtUtc: "End time",
  headcount: "Headcount",
  status: "Status",
  locationId: "Location",
  requiredSkillId: "Skill",
  isPremium: "Premium shift",
  weekKey: "Week",
  cutoffHours: "Edit cutoff",
  emergencyOverrideReason: "Emergency reason",
  staffUserId: "Staff member",
  shiftId: "Shift",
  seventhDayOverrideReason: "7th-day override reason",
};

function formatFieldValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (key === "startAtUtc" || key === "endAtUtc" || key === "clockInAtUtc" || key === "clockOutAtUtc") {
    const dt = DateTime.fromISO(String(value), { zone: "utc" });
    return dt.isValid ? dt.toFormat("EEE dd MMM yyyy · h:mm a") + " UTC" : String(value);
  }
  if (key === "isPremium") return value ? "Yes" : "No";
  if (key === "status") return String(value).charAt(0) + String(value).slice(1).toLowerCase();
  if (typeof value === "string" && value.length > 80) return `${value.slice(0, 80)}…`;
  return String(value);
}

type DiffField = { label: string; before: string; after: string; key: string };

function computeDiff(before: unknown, after: unknown): DiffField[] {
  const b = (before && typeof before === "object" ? before : {}) as Record<string, unknown>;
  const a = (after && typeof after === "object" ? after : {}) as Record<string, unknown>;
  const allKeys = new Set([...Object.keys(b), ...Object.keys(a)]);
  const SKIP = new Set(["id", "weekKey", "createdAt", "createdById"]);
  const diffs: DiffField[] = [];

  for (const key of allKeys) {
    if (SKIP.has(key)) continue;
    const bv = b[key];
    const av = a[key];
    const bStr = formatFieldValue(key, bv);
    const aStr = formatFieldValue(key, av);
    if (bStr !== aStr) {
      diffs.push({ key, label: FIELD_LABELS[key] ?? key, before: bStr, after: aStr });
    }
  }
  return diffs;
}

// ─── action meta ───────────────────────────────────────────────────────────

type ActionMeta = { label: string; icon: string; color: string };

function actionMeta(entityType: string, action: string): ActionMeta {
  const key = `${entityType}:${action}`;
  const map: Record<string, ActionMeta> = {
    "Shift:CREATE":             { label: "Created shift",          icon: "✦", color: "green" },
    "Shift:UPDATE":             { label: "Edited shift",           icon: "✎", color: "blue" },
    "Shift:DELETE":             { label: "Deleted shift",          icon: "✕", color: "red" },
    "ShiftAssignment:CREATE":   { label: "Staff assigned",         icon: "＋", color: "green" },
    "ShiftAssignment:DELETE":   { label: "Staff unassigned",       icon: "−", color: "red" },
    "ScheduleWeek:PUBLISH":     { label: "Schedule published",     icon: "⬆", color: "purple" },
    "ScheduleWeek:UNPUBLISH":   { label: "Schedule unpublished",   icon: "⬇", color: "orange" },
    "CoverageRequest:CREATE":   { label: "Coverage requested",     icon: "↕", color: "blue" },
    "CoverageRequest:ACCEPT":   { label: "Swap accepted",          icon: "✓", color: "green" },
    "CoverageRequest:APPROVE":  { label: "Swap manager-approved",  icon: "✓", color: "green" },
    "CoverageRequest:CANCEL":   { label: "Coverage cancelled",     icon: "✕", color: "red" },
    "CoverageRequest:EXPIRE":   { label: "Coverage expired",       icon: "⌛", color: "orange" },
    "CoverageRequest:CLAIM_OPEN_DROP_PENDING": {
      label: "Volunteered for open shift (pending approval)",
      icon: "☆",
      color: "blue",
    },
    "CoverageRequest:MANAGER_ASSIGN_DROP": { label: "Manager assigned open shift", icon: "★", color: "green" },
    "CoverageRequest:CLAIM": { label: "Open shift finalized", icon: "★", color: "green" },
  };
  return map[key] ?? { label: `${action} (${entityType})`, icon: "●", color: "muted" };
}

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Admin",
  MANAGER: "Manager",
  STAFF: "Staff",
  SYSTEM: "System",
};

function roleBadgeClass(role: string): string {
  const map: Record<string, string> = {
    ADMIN: "shift-timeline__role--admin",
    MANAGER: "shift-timeline__role--manager",
    STAFF: "shift-timeline__role--staff",
    SYSTEM: "shift-timeline__role--system",
  };
  return map[role] ?? "shift-timeline__role--system";
}

// ─── single timeline entry ─────────────────────────────────────────────────

function TimelineEntry({ row }: { row: AuditLogRowDto }): React.ReactElement {
  const meta = actionMeta(row.entityType, row.action);
  const diffs = computeDiff(row.beforeJson, row.afterJson);
  const when = DateTime.fromISO(row.createdAt, { zone: "utc" }).toLocal();
  const timeLabel = when.isValid ? when.toFormat("h:mm a") : "";
  const dateLabel = when.isValid ? when.toFormat("EEE dd MMM") : "";

  return (
    <div className={`shift-timeline__entry shift-timeline__entry--${meta.color}`}>
      <div className="shift-timeline__connector" aria-hidden>
        <span className="shift-timeline__dot">{meta.icon}</span>
      </div>
      <div className="shift-timeline__body">
        <div className="shift-timeline__header">
          <span className="shift-timeline__time">{timeLabel}</span>
          <span className="shift-timeline__date muted">{dateLabel}</span>
          <span className={`shift-timeline__role ${roleBadgeClass(row.actorRole)}`}>
            {row.actorName}
            <span className="shift-timeline__role-label">{ROLE_LABELS[row.actorRole] ?? row.actorRole}</span>
          </span>
        </div>
        <p className="shift-timeline__action">{meta.label}</p>

        {/* Show diff fields for UPDATES */}
        {diffs.length > 0 ? (
          <ul className="shift-timeline__diffs">
            {diffs.map((d) => (
              <li key={d.key} className="shift-timeline__diff-row">
                <span className="shift-timeline__diff-label">{d.label}</span>
                <span className="shift-timeline__diff-before">{d.before}</span>
                <span className="shift-timeline__diff-arrow" aria-hidden>→</span>
                <span className="shift-timeline__diff-after">{d.after}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {/* Assignment / coverage: show staffUserId from afterJson as readable note */}
        {diffs.length === 0 && row.entityType === "ShiftAssignment" && row.action === "CREATE" && row.afterJson ? (
          <p className="shift-timeline__note muted">
            Staff added to shift
          </p>
        ) : null}

        {row.entityType === "CoverageRequest" && row.afterJson && typeof row.afterJson === "object" ? (
          <ul className="shift-timeline__diffs">
            {Object.entries(row.afterJson as Record<string, unknown>)
              .filter(([k]) => !["id", "shiftId", "secondShiftId"].includes(k))
              .slice(0, 4)
              .map(([k, v]) => (
                <li key={k} className="shift-timeline__diff-row shift-timeline__diff-row--info">
                  <span className="shift-timeline__diff-label">{FIELD_LABELS[k] ?? k}</span>
                  <span className="shift-timeline__diff-after">{formatFieldValue(k, v)}</span>
                </li>
              ))}
          </ul>
        ) : null}

        {row.entityType === "ScheduleWeek" && row.afterJson && typeof row.afterJson === "object" ? (
          <p className="shift-timeline__note muted">
            {(row.afterJson as Record<string, unknown>)["emergencyOverrideReason"]
              ? `Emergency: ${String((row.afterJson as Record<string, unknown>)["emergencyOverrideReason"])}`
              : null}
          </p>
        ) : null}
      </div>
    </div>
  );
}

// ─── public component ──────────────────────────────────────────────────────

type Props = { shiftId: string; locationTz?: string };

export function ShiftHistoryTimeline({ shiftId }: Props): React.ReactElement {
  const { token } = useAuth();

  const query = useQuery({
    queryKey: ["audit", "shift", token, shiftId],
    queryFn: () => fetchAuditForShift(token!, shiftId),
    enabled: Boolean(token && shiftId),
  });

  if (query.isLoading) {
    return <p className="muted shift-timeline__loading">Loading history…</p>;
  }
  if (query.isError) {
    return <p className="text-error shift-timeline__loading">Could not load history.</p>;
  }
  const rows = query.data ?? [];

  if (rows.length === 0) {
    return (
      <p className="muted shift-timeline__loading">No changes logged yet for this shift.</p>
    );
  }

  return (
    <div className="shift-timeline">
      {rows.map((row) => (
        <TimelineEntry key={row.id} row={row} />
      ))}
    </div>
  );
}
