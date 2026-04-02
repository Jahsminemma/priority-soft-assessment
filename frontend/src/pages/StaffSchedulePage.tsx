import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createCoverageRequest, fetchLocations, fetchShiftsStaff, fetchSkills } from "../api.js";
import { FeedbackModal } from "../components/FeedbackModal.js";
import { StaffRequestSwapDialog } from "../components/StaffRequestSwapDialog.js";
import { useAuth } from "../context/AuthContext.js";
import { WeekPicker } from "../components/WeekPicker.js";
import { formatShiftRangeLabel } from "../utils/scheduleTime.js";
import { initialWeekKeyFromToday } from "../utils/weekKey.js";
import { normalizeIsoWeekKey } from "@shiftsync/shared";
import { groupStaffShiftsByDay } from "../utils/staffSchedule.js";

export default function StaffSchedulePage(): React.ReactElement {
  const { token, user } = useAuth();
  const isStaff = user?.role === "STAFF";
  const queryClient = useQueryClient();
  const [weekKey, setWeekKey] = useState(() => normalizeIsoWeekKey(initialWeekKeyFromToday()));
  const [swapShiftId, setSwapShiftId] = useState<string | null>(null);
  const [calloutSuccessOpen, setCalloutSuccessOpen] = useState(false);

  const weekKeyNorm = normalizeIsoWeekKey(weekKey);
  const shiftsQuery = useQuery({
    queryKey: ["shifts", "staff", token, weekKeyNorm],
    queryFn: ({ signal }) => fetchShiftsStaff(token!, weekKey, signal),
    enabled: Boolean(isStaff && token && weekKey),
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    structuralSharing: false,
  });

  const locationsQuery = useQuery({
    queryKey: ["locations", token],
    queryFn: () => fetchLocations(token!),
    enabled: Boolean(isStaff && token),
  });

  const skillsQuery = useQuery({
    queryKey: ["skills", token],
    queryFn: () => fetchSkills(token!),
    enabled: Boolean(isStaff && token),
  });

  const calloutMut = useMutation({
    mutationFn: async (shiftId: string): Promise<{ id: string }> => {
      return createCoverageRequest(token!, { type: "DROP", shiftId });
    },
    onSuccess: () => {
      setCalloutSuccessOpen(true);
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      void queryClient.invalidateQueries({ queryKey: ["shifts"] });
    },
  });

  const locById = useMemo(
    () => new Map((locationsQuery.data ?? []).map((l) => [l.id, l])),
    [locationsQuery.data],
  );
  const skillById = useMemo(
    () => new Map((skillsQuery.data ?? []).map((s) => [s.id, s.name])),
    [skillsQuery.data],
  );

  const dayGroups = useMemo(() => {
    const shifts = shiftsQuery.data ?? [];
    const locs = locationsQuery.data ?? [];
    return groupStaffShiftsByDay(shifts, locs);
  }, [shiftsQuery.data, locationsQuery.data]);

  if (!isStaff) {
    return (
      <div className="page">
        <h1 className="page__title">My schedule</h1>
        <div className="card">
          <p className="muted">This view is for staff. Sign in with a staff account to see your published shifts.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page page--staff-schedule">
      <header className="staff-schedule__header">
        <h1 className="page__title staff-schedule__title">My schedule</h1>
        <p className="page__lead muted staff-schedule__lead">
          Open a shift for details, or use callout / swap from each card. Accept or approve coverage requests from{" "}
          <strong>Notifications</strong>.
        </p>
      </header>

      <div className="card staff-schedule__picker-card">
        <WeekPicker weekKey={weekKey} onWeekKeyChange={setWeekKey} id="my-schedule-week" compact />
      </div>

      {shiftsQuery.isLoading ? (
        <p className="muted staff-schedule__status">Loading your week…</p>
      ) : null}
      {shiftsQuery.isError ? <p className="text-error staff-schedule__status">We couldn’t load your schedule. Try again.</p> : null}
      {calloutMut.isError ? (
        <p className="text-error staff-schedule__status">
          {calloutMut.error instanceof Error ? calloutMut.error.message : "Could not submit callout request."}
        </p>
      ) : null}
      <div className="staff-schedule__days">
        {dayGroups.map((g) => (
          <section key={g.dayKey} className="staff-schedule__day" aria-labelledby={`day-${g.dayKey}`}>
            <h2 id={`day-${g.dayKey}`} className="staff-schedule__day-title">
              {g.dayTitle}
            </h2>
            <ul className="staff-schedule__list">
              {g.shifts.map((s) => {
                const loc = locById.get(s.locationId);
                const skill = skillById.get(s.requiredSkillId);
                if (!loc) return null;
                return (
                  <li key={s.id}>
                    <article className="staff-shift-card">
                      <Link to={`/my-shifts/${s.id}`} className="staff-shift-card__main staff-shift-card__main--link">
                        <p className="staff-shift-card__location">{loc.name}</p>
                        <p className="staff-shift-card__time">{formatShiftRangeLabel(s.startAtUtc, s.endAtUtc, loc.tzIana)}</p>
                        {skill ? <p className="staff-shift-card__skill">{skill}</p> : null}
                        <p className="staff-shift-card__status">
                          <span className={`staff-shift-card__badge staff-shift-card__badge--${s.status.toLowerCase()}`}>
                            {s.status === "PUBLISHED" ? "Published" : s.status}
                          </span>
                          {s.isPremium ? <span className="staff-shift-card__badge staff-shift-card__badge--premium">Premium</span> : null}
                        </p>
                        <span className="staff-shift-card__detail-hint">View details →</span>
                      </Link>
                      <div className="staff-shift-card__actions">
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm staff-shift-card__btn"
                          disabled={calloutMut.isPending}
                          onClick={() => void calloutMut.mutateAsync(s.id)}
                        >
                          {calloutMut.isPending && calloutMut.variables === s.id ? "Sending…" : "Request callout"}
                        </button>
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm staff-shift-card__btn"
                          onClick={() => setSwapShiftId(s.id)}
                        >
                          Request swap
                        </button>
                      </div>
                    </article>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      {shiftsQuery.isSuccess && dayGroups.length === 0 ? (
        <div className="card staff-schedule__empty">
          <p className="staff-schedule__empty-title">Nothing this week</p>
          <p className="muted">No published shifts yet. Try another week or ask your manager when the schedule goes live.</p>
        </div>
      ) : null}

      {token && swapShiftId ? (
        <StaffRequestSwapDialog
          open
          onClose={() => setSwapShiftId(null)}
          token={token}
          shiftId={swapShiftId}
        />
      ) : null}

      <FeedbackModal
        open={calloutSuccessOpen}
        variant="success"
        title="Callout posted"
        message="Your shift is offered for pickup. You stay assigned until a manager approves. Watch Notifications for updates."
        onClose={() => setCalloutSuccessOpen(false)}
      />
    </div>
  );
}
