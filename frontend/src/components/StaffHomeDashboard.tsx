import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { normalizeIsoWeekKey } from "@shiftsync/shared";
import {
  claimCoverageRequest,
  fetchLocations,
  fetchNotifications,
  fetchOpenCallouts,
  fetchShiftsStaff,
  fetchSkills,
  requestClockInCode,
} from "../api.js";
import {
  formatFullCalendarDateInZone,
  formatShiftDateStack,
  formatShiftDurationHuman,
  formatShiftWallTimeArrow,
} from "../utils/scheduleTime.js";
import { initialWeekKeyFromToday, shiftWeekKey } from "../utils/weekKey.js";
import { shiftsStartingTodayAtLocation, totalScheduledHours } from "../utils/staffSchedule.js";

type StaffHomeDashboardProps = {
  token: string;
  userName: string | undefined;
};

function IconChevronRight(): React.ReactElement {
  return (
    <svg className="staff-dash__chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
      <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function StaffHomeDashboard({ token, userName }: StaffHomeDashboardProps): React.ReactElement {
  const queryClient = useQueryClient();
  const [clockCodeResult, setClockCodeResult] = useState<{ code: string; expiresAtUtc: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const weekKey = useMemo(() => normalizeIsoWeekKey(initialWeekKeyFromToday()), []);
  const nextWeekKey = useMemo(() => shiftWeekKey(weekKey, 1), [weekKey]);

  const weekQueries = useQueries({
    queries: [
      {
        queryKey: ["shifts", "staff", token, weekKey],
        queryFn: ({ signal }: { signal?: AbortSignal }) => fetchShiftsStaff(token, weekKey, signal),
        enabled: Boolean(token),
      },
      {
        queryKey: ["shifts", "staff", token, nextWeekKey],
        queryFn: ({ signal }: { signal?: AbortSignal }) => fetchShiftsStaff(token, nextWeekKey!, signal),
        enabled: Boolean(token && nextWeekKey && nextWeekKey !== weekKey),
      },
    ],
  });

  const locationsQuery = useQuery({
    queryKey: ["locations", token],
    queryFn: () => fetchLocations(token),
    enabled: Boolean(token),
  });

  const skillsQuery = useQuery({
    queryKey: ["skills", token],
    queryFn: () => fetchSkills(token),
    enabled: Boolean(token),
  });

  const notificationsQuery = useQuery({
    queryKey: ["notifications", token],
    queryFn: () => fetchNotifications(token),
    enabled: Boolean(token),
  });

  const openCalloutsQuery = useQuery({
    queryKey: ["openCallouts", token],
    queryFn: () => fetchOpenCallouts(token),
    enabled: Boolean(token),
    staleTime: 15_000,
  });

  const claimOpenMut = useMutation({
    mutationFn: (requestId: string) => claimCoverageRequest(token, requestId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["openCallouts"] });
      void queryClient.invalidateQueries({ queryKey: ["shifts"] });
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const clockCodeMut = useMutation({
    mutationFn: (shiftId: string) => requestClockInCode(token, shiftId),
    onSuccess: (data) => {
      setClockCodeResult(data);
      setCopied(false);
    },
  });

  useEffect(() => {
    if (!clockCodeResult) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setClockCodeResult(null);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [clockCodeResult]);

  const locById = useMemo(
    () => new Map((locationsQuery.data ?? []).map((l) => [l.id, l])),
    [locationsQuery.data],
  );
  const skillById = useMemo(
    () => new Map((skillsQuery.data ?? []).map((s) => [s.id, s.name])),
    [skillsQuery.data],
  );

  const shifts = useMemo(() => {
    const a = weekQueries[0]?.data ?? [];
    const b = weekQueries[1]?.data ?? [];
    const byId = new Map([...a, ...b].map((s) => [s.id, s]));
    return [...byId.values()].sort((x, y) => x.startAtUtc.localeCompare(y.startAtUtc));
  }, [weekQueries]);

  const loading = weekQueries.some((q) => q.isLoading);
  const error = weekQueries.some((q) => q.isError);

  const upcoming = useMemo(() => {
    const now = DateTime.utc();
    return shifts
      .filter((s) => {
        const end = DateTime.fromISO(s.endAtUtc, { zone: "utc" });
        return end.isValid && end > now;
      })
      .sort((a, b) => a.startAtUtc.localeCompare(b.startAtUtc));
  }, [shifts]);

  const todayAtVenue = useMemo(() => shiftsStartingTodayAtLocation(shifts, locById), [shifts, locById]);
  const heroShift = todayAtVenue[0] ?? upcoming[0] ?? null;
  const listShifts = useMemo(() => {
    if (!heroShift) return upcoming.slice(0, 8);
    return upcoming.filter((s) => s.id !== heroShift.id).slice(0, 8);
  }, [upcoming, heroShift]);

  const hours = totalScheduledHours(shifts);
  const unread = (notificationsQuery.data ?? []).filter((n) => !n.readAt).length;

  const greeting = useMemo(() => {
    const h = DateTime.now().hour;
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  }, []);

  const firstName = userName?.split(/\s+/)[0] ?? "there";

  const statusLine = useMemo(() => {
    if (todayAtVenue.length === 0 && !upcoming.length) return "No upcoming shifts on your schedule.";
    if (todayAtVenue.length === 1) return "You have one shift today.";
    if (todayAtVenue.length > 1) return `You have ${todayAtVenue.length} shifts today.`;
    if (upcoming.length === 1) return "You have one shift coming up.";
    return `You have ${upcoming.length} upcoming shifts.`;
  }, [todayAtVenue.length, upcoming.length]);

  const heroLoc = heroShift ? locById.get(heroShift.locationId) : undefined;
  const heroSkill = heroShift ? skillById.get(heroShift.requiredSkillId) : undefined;

  return (
    <div className="staff-dash">
      <header className="staff-dash__hero">
        <p className="staff-dash__greet">{greeting},</p>
        <h1 className="staff-dash__name">{firstName}</h1>
        <p className="staff-dash__status">{statusLine}</p>
      </header>

      <section className="staff-dash__meta" aria-label="Summary">
        <div className="staff-dash__meta-item">
          <span className="staff-dash__meta-value">{hours}</span>
          <span className="staff-dash__meta-label">Hours scheduled</span>
        </div>
        <Link to="/notifications" className="staff-dash__meta-item staff-dash__meta-item--link">
          <span className="staff-dash__meta-value">{unread}</span>
          <span className="staff-dash__meta-label">Unread alerts</span>
        </Link>
      </section>

      {openCalloutsQuery.data && openCalloutsQuery.data.length > 0 ? (
        <section className="staff-dash__open-callouts card" aria-labelledby="staff-open-callouts-title">
          <h2 id="staff-open-callouts-title" className="staff-dash__open-callouts-title">
            Open shifts — claim now
          </h2>
          <p className="staff-dash__open-callouts-hint muted">
            A teammate called out. First eligible person to claim gets the shift (rules apply).
          </p>
          <ul className="staff-dash__open-callouts-list">
            {openCalloutsQuery.data.map((c) => (
              <li key={c.requestId} className="staff-dash__open-callout-row">
                <div>
                  <p className="staff-dash__open-callout-who">
                    <strong>{c.requesterName}</strong> needs coverage
                  </p>
                  <p className="staff-dash__open-callout-shift">
                    {c.shift.locationName} · {c.shift.skillName}
                    <br />
                    {c.shift.localDateLabel} · {c.shift.localTimeLabel}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  disabled={claimOpenMut.isPending}
                  onClick={() => claimOpenMut.mutate(c.requestId)}
                >
                  {claimOpenMut.isPending && claimOpenMut.variables === c.requestId ? "…" : "Claim"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {loading ? <p className="muted staff-dash__loading">Loading your schedule…</p> : null}
      {error ? <p className="text-error">We couldn’t load your shifts. Try again.</p> : null}

      {!loading && !error && heroShift && heroLoc ? (
        <>
          <div className="staff-dash__hero-card">
            <Link to={`/my-shifts/${heroShift.id}`} className="staff-dash__hero-card-link">
              <div className="staff-dash__hero-card-inner">
                <p className="staff-dash__hero-time">{formatShiftWallTimeArrow(heroShift.startAtUtc, heroShift.endAtUtc, heroLoc.tzIana)}</p>
                <p className="staff-dash__hero-duration">{formatShiftDurationHuman(heroShift.startAtUtc, heroShift.endAtUtc)}</p>
                <p className="staff-dash__hero-date">{formatFullCalendarDateInZone(heroShift.startAtUtc, heroLoc.tzIana)}</p>
                <div className="staff-dash__hero-loc">
                  <span className="staff-dash__dot" aria-hidden />
                  <span>
                    {heroLoc.name}
                    {heroSkill ? ` · ${heroSkill}` : ""}
                  </span>
                </div>
                <span className="staff-dash__hero-cta">View shift details</span>
              </div>
            </Link>
            <div className="staff-dash__hero-card-actions">
              <button
                type="button"
                className="btn btn--primary btn--sm"
                disabled={clockCodeMut.isPending}
                onClick={() => void clockCodeMut.mutateAsync(heroShift.id)}
              >
                {clockCodeMut.isPending ? "…" : "Clock in"}
              </button>
              <p className="staff-dash__hero-code-hint muted">Show the code to your manager to verify your punch.</p>
            </div>
            {clockCodeMut.isError ? (
              <p className="staff-dash__hero-code-err text-error">{(clockCodeMut.error as Error).message}</p>
            ) : null}
          </div>
          {clockCodeResult
            ? createPortal(
                <div className="feedback-modal-root">
                  <div className="feedback-modal-backdrop" aria-hidden onClick={() => setClockCodeResult(null)} />
                  <div
                    className="feedback-modal staff-dash__clock-code-modal"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="staff-clock-code-title"
                  >
                    <h2 id="staff-clock-code-title" className="feedback-modal__title">
                      Your clock-in code
                    </h2>
                    <p className="staff-dash__clock-code-value mono" aria-live="polite">
                      {clockCodeResult.code}
                    </p>
                    <p className="feedback-modal__message muted">
                      {(() => {
                        const exp = DateTime.fromISO(clockCodeResult.expiresAtUtc, { zone: "utc" }).toLocal();
                        return exp.isValid ? `Expires ${exp.toFormat("h:mm a")} local time.` : "";
                      })()}
                    </p>
                    <div className="staff-dash__clock-code-btns">
                      <button
                        type="button"
                        className="btn btn--secondary"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(clockCodeResult.code);
                            setCopied(true);
                            window.setTimeout(() => setCopied(false), 2000);
                          } catch {
                            /* ignore */
                          }
                        }}
                      >
                        {copied ? "Copied" : "Copy code"}
                      </button>
                      <button type="button" className="btn btn--primary" onClick={() => setClockCodeResult(null)}>
                        Done
                      </button>
                    </div>
                  </div>
                </div>,
                document.body,
              )
            : null}
        </>
      ) : null}

      {!loading && !error && !heroShift ? (
        <div className="staff-dash__empty card">
          <h2 className="card__title">Nothing scheduled</h2>
          <p className="muted">No published shifts yet. Check back or ask your manager when the schedule is live.</p>
          <Link to="/my-week" className="btn btn--secondary staff-dash__empty-btn">
            My week
          </Link>
        </div>
      ) : null}

      {!loading && !error && listShifts.length > 0 ? (
        <section className="staff-dash__upcoming" aria-labelledby="staff-dash-upcoming-title">
          <div className="staff-dash__upcoming-head">
            <h2 id="staff-dash-upcoming-title" className="staff-dash__upcoming-title">
              Your upcoming shifts
            </h2>
            <Link to="/my-week" className="staff-dash__view-all">
              View all
            </Link>
          </div>
          <ul className="staff-dash__shift-list">
            {listShifts.map((s) => {
              const loc = locById.get(s.locationId);
              if (!loc) return null;
              const stack = formatShiftDateStack(s.startAtUtc, loc.tzIana);
              const skill = skillById.get(s.requiredSkillId);
              return (
                <li key={s.id}>
                  <Link to={`/my-shifts/${s.id}`} className="staff-dash__shift-row">
                    <div className="staff-dash__shift-stack" aria-hidden>
                      <span>{stack.line1}</span>
                      <span className="staff-dash__shift-stack-day">{stack.line2}</span>
                      <span>{stack.line3}</span>
                    </div>
                    <div className="staff-dash__shift-body">
                      <p className="staff-dash__shift-time">{formatShiftWallTimeArrow(s.startAtUtc, s.endAtUtc, loc.tzIana)}</p>
                      <p className="staff-dash__shift-sub">
                        <span className="staff-dash__dot staff-dash__dot--sm" aria-hidden />
                        {loc.name}
                        {skill ? ` · ${skill}` : ""}
                      </p>
                      <p className="staff-dash__shift-dur">{formatShiftDurationHuman(s.startAtUtc, s.endAtUtc)}</p>
                    </div>
                    <IconChevronRight />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section className="staff-dash__quick" aria-label="Shortcuts">
        <Link to="/my-week" className="staff-dash__quick-link">
          Full schedule
        </Link>
        <Link to="/clock" className="staff-dash__quick-link">
          Work history
        </Link>
      </section>
    </div>
  );
}
