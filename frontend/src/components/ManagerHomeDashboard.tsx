import { useMemo } from "react";
import { Link } from "react-router-dom";
import { DateTime } from "luxon";
import { useQuery } from "@tanstack/react-query";
import { normalizeIsoWeekKey } from "@shiftsync/shared";
import { fetchLocations, fetchOvertimeCostWeekReport } from "../api.js";
import { ManagerCoverageQueueSidebar } from "./ManagerCoverageQueueSidebar.js";
import { formatWeekRangeLabel, initialWeekKeyFromToday } from "../utils/weekKey.js";

type Props = {
  token: string;
  userName: string | undefined;
  role: string | undefined;
};

function IconChevron(): React.ReactElement {
  return (
    <svg className="manager-action-tile__chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
      <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M9 6l6 6-6 6" />
    </svg>
  );
}

function IconCalendar(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
      <path
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
      />
    </svg>
  );
}

function IconChart(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
      <path strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" d="M18 20V10M12 20V4M6 20v-6" />
    </svg>
  );
}

function IconClock(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
      <path
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

function IconBell(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
      <path
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
      />
    </svg>
  );
}

function IconSettings(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
      <path
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
      />
      <path strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

const usd = (n: number): string =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

export function ManagerHomeDashboard({ token, userName, role }: Props): React.ReactElement {
  const weekKey = useMemo(() => normalizeIsoWeekKey(initialWeekKeyFromToday()), []);
  const weekLabel = useMemo(() => formatWeekRangeLabel(weekKey), [weekKey]);

  const locationsQuery = useQuery({
    queryKey: ["locations", token],
    queryFn: () => fetchLocations(token),
    enabled: Boolean(token),
  });
  const primaryLocationId = locationsQuery.data?.[0]?.id;
  const overtimeCostQuery = useQuery({
    queryKey: ["analytics", "overtimeCost", token, primaryLocationId, weekKey],
    queryFn: () => fetchOvertimeCostWeekReport(token, primaryLocationId!, weekKey),
    enabled: Boolean(token && primaryLocationId),
    staleTime: 60_000,
  });
  const primaryLocationName = locationsQuery.data?.find((l) => l.id === primaryLocationId)?.name;

  const topOtDrivers = useMemo(() => {
    const rows = overtimeCostQuery.data?.assignments ?? [];
    return [...rows]
      .filter((a) => a.otUsd > 0)
      .sort((a, b) => b.otUsd - a.otUsd)
      .slice(0, 5);
  }, [overtimeCostQuery.data]);

  const greeting = useMemo(() => {
    const h = DateTime.now().hour;
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  }, []);

  const firstName = userName?.split(/\s+/)[0] ?? "there";
  const roleLabel = role === "ADMIN" ? "Administrator" : "Manager";

  return (
    <div className="page page--manager-dash">
      <div className="manager-dash__layout">
        <div className="manager-dash__main">
          <header className="manager-hero">
            <p className="manager-hero__kicker">{roleLabel} · ShiftSync</p>
            <h1 className="manager-hero__title">
              {greeting}, {firstName}
            </h1>
            <p className="manager-hero__lead">
              Run schedules, coverage, and team visibility from one place. This week:{" "}
              <span className="manager-hero__week-pill">{weekLabel}</span>
            </p>
          </header>

          {overtimeCostQuery.data != null ? (
            <div className="manager-dash__ot-card" aria-live="polite">
              <p className="manager-dash__ot-card-kicker">Projected overtime payroll</p>
              <p className="manager-dash__ot-card-value">{usd(overtimeCostQuery.data.totalOtUsd)}</p>
              <p className="manager-dash__ot-card-meta">
                {weekLabel}
                {primaryLocationName ? ` · ${primaryLocationName}` : ""} · 40h straight cap, 1.5× OT (FIFO by shift start)
              </p>
              <p className="manager-dash__ot-card-meta">
                Week labor (straight + OT): {usd(overtimeCostQuery.data.totalLaborUsd)}
              </p>
              {topOtDrivers.length > 0 ? (
                <div className="manager-dash__ot-drivers">
                  <p className="manager-dash__ot-drivers-title">Assignments driving OT (FIFO by start time)</p>
                  <ul className="manager-dash__ot-drivers-list">
                    {topOtDrivers.map((a) => (
                      <li key={a.assignmentId}>
                        <span className="manager-dash__ot-drivers-name">{a.staffName}</span>
                        <span className="muted">
                          {" "}
                          · OT {usd(a.otUsd)} ({Math.round(a.otMinutes)} min @ 1.5×)
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="manager-dash__ot-card-meta muted">No OT-attributed minutes this week at this site.</p>
              )}
              <Link to="/analytics" className="manager-dash__ot-card-link">
                View hours and fairness in Analytics →
              </Link>
            </div>
          ) : overtimeCostQuery.isLoading && primaryLocationId ? (
            <p className="muted small" style={{ marginTop: "0.75rem" }}>
              Loading projected labor…
            </p>
          ) : null}

          <section className="manager-section" aria-labelledby="manager-actions-heading">
            <div className="manager-section__head">
              <h2 id="manager-actions-heading" className="manager-section__title">
                Quick actions
              </h2>
              <p className="manager-section__subtitle">Jump to the tools you use most</p>
            </div>
            <div className="manager-actions">
              <Link to="/schedule" className="manager-action-tile">
                <span className="manager-action-tile__icon" aria-hidden>
                  <IconCalendar />
                </span>
                <span className="manager-action-tile__body">
                  <span className="manager-action-tile__label">Schedule</span>
                  <span className="manager-action-tile__desc">Build shifts, assign staff, publish weeks</span>
                </span>
                <IconChevron />
              </Link>
              <Link to="/analytics" className="manager-action-tile">
                <span className="manager-action-tile__icon" aria-hidden>
                  <IconChart />
                </span>
                <span className="manager-action-tile__body">
                  <span className="manager-action-tile__label">Analytics</span>
                  <span className="manager-action-tile__desc">Hours, fairness, and overtime trends</span>
                </span>
                <IconChevron />
              </Link>
              <Link to="/clock" className="manager-action-tile">
                <span className="manager-action-tile__icon" aria-hidden>
                  <IconClock />
                </span>
                <span className="manager-action-tile__body">
                  <span className="manager-action-tile__label">Live clock</span>
                  <span className="manager-action-tile__desc">See who is on the clock right now</span>
                </span>
                <IconChevron />
              </Link>
            </div>
          </section>

          <section className="manager-section manager-section--account" aria-labelledby="manager-account-heading">
            <h2 id="manager-account-heading" className="manager-section__title manager-section__title--inline">
              Account
            </h2>
            <div className="manager-account-links">
              <Link to="/notifications" className="manager-account-links__item">
                <span className="manager-account-links__icon" aria-hidden>
                  <IconBell />
                </span>
                <span>Notifications</span>
              </Link>
              <Link to="/settings" className="manager-account-links__item">
                <span className="manager-account-links__icon" aria-hidden>
                  <IconSettings />
                </span>
                <span>Notification settings</span>
              </Link>
            </div>
          </section>
        </div>

        <aside className="manager-dash__aside" aria-label="Coverage queue">
          <div className="manager-dash__aside-panel">
            <ManagerCoverageQueueSidebar token={token} />
          </div>
        </aside>
      </div>
    </div>
  );
}
