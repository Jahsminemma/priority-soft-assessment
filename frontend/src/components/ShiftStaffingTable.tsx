import { formatShiftRangeLabel } from "../utils/scheduleTime.js";
import type { ShiftDto } from "@shiftsync/shared";

export type ShiftAssignmentRow = {
  assignmentId: string;
  staffUserId: string;
  staffName: string;
  staffEmail: string;
};

type Props = {
  shifts: ShiftDto[];
  locationTz: string;
  skillNameById: Map<string, string>;
  /** Parallel to `shifts`; undefined while that row is still loading. */
  assignmentsPerShift: Array<ShiftAssignmentRow[] | undefined>;
  loading: boolean;
  emptyMessage?: string;
};

/**
 * Read-only grid: each shift row shows who is assigned (for overview / schedule context).
 */
export function ShiftStaffingTable({
  shifts,
  locationTz,
  skillNameById,
  assignmentsPerShift,
  loading,
  emptyMessage = "No shifts for this week.",
}: Props): React.ReactElement {
  if (loading && shifts.length === 0) {
    return <p className="muted">Loading staffing…</p>;
  }
  if (!shifts.length) {
    return <p className="muted">{emptyMessage}</p>;
  }

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>When ({locationTz})</th>
            <th>Skill</th>
            <th>Status</th>
            <th>Slots</th>
            <th>Assigned staff</th>
          </tr>
        </thead>
        <tbody>
          {shifts.map((s, i) => {
            const assign = assignmentsPerShift[i];
            const sk = skillNameById.get(s.requiredSkillId) ?? "—";
            const cnt = s.assignedCount ?? assign?.length ?? 0;
            const names =
              assign && assign.length > 0 ? (
                <ul className="staffing-names">
                  {assign.map((a) => (
                    <li key={a.assignmentId}>
                      <span className="staffing-names__name">{a.staffName}</span>
                      <span className="muted small staffing-names__email">{a.staffEmail}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="muted">—</span>
              );
            return (
              <tr key={s.id}>
                <td>
                  <span className="staffing-when">{formatShiftRangeLabel(s.startAtUtc, s.endAtUtc, locationTz)}</span>
                </td>
                <td>{sk}</td>
                <td>
                  <span className={`badge badge--${s.status === "PUBLISHED" ? "ok" : "muted"}`}>{s.status}</span>
                  {s.isPremium ? <span className="muted small"> · premium</span> : null}
                </td>
                <td>
                  {cnt}/{s.headcount}
                </td>
                <td>{assign === undefined && loading ? <span className="muted">…</span> : names}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
