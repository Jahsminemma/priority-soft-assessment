import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQueries, useQuery } from "@tanstack/react-query";
import { fetchLocations, fetchShiftAssignments, fetchShifts, fetchSkills } from "../api.js";
import { useAuth } from "../context/AuthContext.js";
import { ShiftStaffingTable } from "../components/ShiftStaffingTable.js";
import { WeekPicker } from "../components/WeekPicker.js";
import { initialWeekKeyFromToday } from "../utils/weekKey.js";
import { normalizeIsoWeekKey } from "@shiftsync/shared";

export default function AssignmentsPage(): React.ReactElement {
  const { token, user } = useAuth();
  const canManage = user?.role === "ADMIN" || user?.role === "MANAGER";
  const [locationId, setLocationId] = useState("");
  const [weekKey, setWeekKey] = useState(() => normalizeIsoWeekKey(initialWeekKeyFromToday()));

  const locationsQuery = useQuery({
    queryKey: ["locations", token],
    queryFn: () => fetchLocations(token!),
    enabled: Boolean(canManage && token),
  });

  const skillsQuery = useQuery({
    queryKey: ["skills", token],
    queryFn: () => fetchSkills(token!),
    enabled: Boolean(canManage && token),
  });

  const skillNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const sk of skillsQuery.data ?? []) m.set(sk.id, sk.name);
    return m;
  }, [skillsQuery.data]);

  useEffect(() => {
    const list = locationsQuery.data;
    if (!list?.length || locationId) return;
    setLocationId(list[0]!.id);
  }, [locationsQuery.data, locationId]);

  const weekKeyNorm = normalizeIsoWeekKey(weekKey);
  const shiftsQuery = useQuery({
    queryKey: ["shifts", token, locationId, weekKeyNorm],
    queryFn: ({ signal }) => fetchShifts(token!, locationId, weekKey, signal),
    enabled: Boolean(canManage && token && locationId && weekKey),
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    structuralSharing: false,
  });

  const shifts = shiftsQuery.data ?? [];
  const assignmentQueries = useQueries({
    queries: shifts.map((s) => ({
      queryKey: ["shiftAssignments", token, s.id] as const,
      queryFn: () => fetchShiftAssignments(token!, s.id),
      enabled: Boolean(canManage && token && s.id),
    })),
  });
  const assignmentsPerShift = assignmentQueries.map((q) => q.data);
  const assignmentsLoading = assignmentQueries.some((q) => q.isPending);

  const locationTz = useMemo(
    () => locationsQuery.data?.find((l) => l.id === locationId)?.tzIana ?? "UTC",
    [locationsQuery.data, locationId],
  );

  if (!canManage) {
    return (
      <div className="page">
        <h1 className="page__title">Staffing overview</h1>
        <div className="card">
          <p className="muted">Only managers and admins can view staffing by location. If you need this, ask your administrator.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <h1 className="page__title">Staffing overview</h1>
      <p className="page__lead muted">
        See who is assigned to each shift for the week you pick (times in the <strong>location’s timezone</strong>). To add
        or change people, use{" "}
        <Link to="/schedule">
          <strong>Schedule & shifts</strong>
        </Link>
        .
      </p>

      <div className="card stack">
        <label className="field">
          <span className="field__label">Location</span>
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            {(locationsQuery.data ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>

        <WeekPicker weekKey={weekKey} onWeekKeyChange={setWeekKey} id="staffing-overview-week" />
      </div>

      <div className="card stack">
        <h2 className="card__title">Shifts and assignments</h2>
        {shiftsQuery.isLoading ? <p className="muted">Loading shifts…</p> : null}
        <ShiftStaffingTable
          shifts={shifts}
          locationTz={locationTz}
          skillNameById={skillNameById}
          assignmentsPerShift={assignmentsPerShift}
          loading={assignmentsLoading || shiftsQuery.isLoading}
        />
      </div>
    </div>
  );
}
