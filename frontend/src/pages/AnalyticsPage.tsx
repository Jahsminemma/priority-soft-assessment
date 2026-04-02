import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchFairnessReport, fetchLocations, fetchOvertimeWeekReport } from "../api.js";
import { useAuth } from "../context/AuthContext.js";
import { WeekPicker } from "../components/WeekPicker.js";
import {
  formatWeekRangeCompact,
  initialWeekKeyFromToday,
  shiftWeekKey,
} from "../utils/weekKey.js";
import { normalizeIsoWeekKey } from "@shiftsync/shared";

function defaultWeekKeyLast(): string {
  const todayWk = normalizeIsoWeekKey(initialWeekKeyFromToday());
  return shiftWeekKey(todayWk, -1) ?? todayWk;
}

type TimePreset = "last-week" | "this-week" | "custom";

function fairnessStatusLabel(
  scheduledHours: number,
  desired: number | null,
): "under" | "over" | "match" | "none" {
  if (desired == null) return "none";
  const d = desired;
  const h = scheduledHours;
  if (h < d - 0.05) return "under";
  if (h > d + 0.05) return "over";
  return "match";
}

export default function AnalyticsPage(): React.ReactElement {
  const { token, user } = useAuth();
  const canManage = user?.role === "ADMIN" || user?.role === "MANAGER";

  const [locationId, setLocationId] = useState<string | "all">("all");
  const [timePreset, setTimePreset] = useState<TimePreset>("last-week");
  const [weekKey, setWeekKey] = useState(() => defaultWeekKeyLast());

  const locationsQuery = useQuery({
    queryKey: ["locations", token],
    queryFn: () => fetchLocations(token!),
    enabled: Boolean(canManage && token),
  });

  useEffect(() => {
    const list = locationsQuery.data;
    if (!list?.length) return;
    setLocationId((prev) => {
      if (prev === "all" && user?.role === "ADMIN") return "all";
      if (prev === "all" && user?.role === "MANAGER") return list[0]!.id;
      if (typeof prev === "string" && prev !== "all" && list.some((l) => l.id === prev)) return prev;
      return user?.role === "ADMIN" ? "all" : list[0]!.id;
    });
  }, [locationsQuery.data, user?.role]);

  useEffect(() => {
    const todayWk = normalizeIsoWeekKey(initialWeekKeyFromToday());
    if (timePreset === "this-week") {
      setWeekKey(todayWk);
    } else if (timePreset === "last-week") {
      const w = shiftWeekKey(todayWk, -1);
      if (w) setWeekKey(w);
    }
  }, [timePreset]);

  const fairnessQuery = useQuery({
    queryKey: ["analytics", "fairness", locationId, weekKey],
    queryFn: () => fetchFairnessReport(token!, locationId, weekKey),
    enabled: Boolean(canManage && token && locationId && weekKey),
  });

  const overtimeQuery = useQuery({
    queryKey: ["analytics", "overtime", locationId, weekKey],
    queryFn: () => fetchOvertimeWeekReport(token!, locationId, weekKey),
    enabled: Boolean(canManage && token && locationId && weekKey),
  });

  const rows = fairnessQuery.data ?? [];

  const chartMax = useMemo(() => {
    let m = 40;
    for (const r of rows) {
      if (r.desiredHoursWeekly != null) m = Math.max(m, r.desiredHoursWeekly);
      m = Math.max(m, r.scheduledHours);
    }
    return Math.ceil(m / 5) * 5 || 40;
  }, [rows]);

  const avgDesired = useMemo(() => {
    const list = rows.map((r) => r.desiredHoursWeekly).filter((x): x is number => x != null);
    if (!list.length) return 0;
    return list.reduce((a, b) => a + b, 0) / list.length;
  }, [rows]);

  const totalPremium = useMemo(() => rows.reduce((s, r) => s + r.premiumShiftCount, 0), [rows]);

  const maxPremiumCount = useMemo(() => Math.max(1, ...rows.map((r) => r.premiumShiftCount)), [rows]);

  const timeRangeLabel =
    timePreset === "last-week"
      ? "Last week"
      : timePreset === "this-week"
        ? "This week"
        : formatWeekRangeCompact(weekKey);

  if (!canManage) {
    return (
      <div className="page">
        <h1 className="page__title">Schedule analytics</h1>
        <div className="card">
          <p className="muted">These reports are for managers and admins. Ask your administrator if you need access.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page analytics-page">
      <header className="analytics-page__header">
        <h1 className="page__title analytics-page__title">Schedule analytics</h1>
        <div className="analytics-page__filters">
          <label className="field field--inline analytics-page__filter">
            <span className="field__label">Location</span>
            <select
              value={locationId}
              onChange={(e) => {
                const v = e.target.value;
                setLocationId(v === "all" ? "all" : v);
              }}
              disabled={!locationsQuery.data?.length}
            >
              {user?.role === "ADMIN" ? (
                <option value="all">All locations</option>
              ) : null}
              {(locationsQuery.data ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field field--inline analytics-page__filter">
            <span className="field__label">Time range</span>
            <select
              value={timePreset}
              onChange={(e) => setTimePreset(e.target.value as TimePreset)}
            >
              <option value="last-week">Last week</option>
              <option value="this-week">This week</option>
              <option value="custom">Custom week…</option>
            </select>
          </label>
        </div>
      </header>

      {timePreset === "custom" ? (
        <div className="analytics-page__custom-week card card--compact">
          <WeekPicker weekKey={weekKey} onWeekKeyChange={(wk) => setWeekKey(normalizeIsoWeekKey(wk))} id="analytics-week" />
        </div>
      ) : null}

      <section className="card analytics-card analytics-card--chart">
        <h2 className="analytics-card__title">
          <span className="analytics-card__title-icon" aria-hidden>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 3v18h18" />
              <path d="M7 18V9" />
              <path d="M12 18v-5" />
              <path d="M17 18v-9" />
            </svg>
          </span>
          Hours distribution ({timeRangeLabel})
        </h2>
        {fairnessQuery.isLoading ? <p className="muted">Loading…</p> : null}
        {fairnessQuery.isError ? (
          <p className="text-error">We couldn’t load this chart. Try again or pick another week.</p>
        ) : null}
        {!fairnessQuery.isLoading && !fairnessQuery.isError && rows.length === 0 ? (
          <p className="muted analytics-card__empty">No certified staff in this scope for the selected week.</p>
        ) : null}
        {!fairnessQuery.isLoading && !fairnessQuery.isError && rows.length > 0 ? (
          <>
            <div className="analytics-bar-chart" role="img" aria-label="Desired hours per staff member">
              <div className="analytics-bar-chart__y-axis" aria-hidden>
                {[0, 0.25, 0.5, 0.75, 1].map((t) => (
                  <span key={t} className="analytics-bar-chart__tick">
                    {Math.round(chartMax * (1 - t))}
                  </span>
                ))}
              </div>
              <div className="analytics-bar-chart__plot">
                {rows.map((r) => {
                  const desired = r.desiredHoursWeekly ?? 0;
                  const hPct = chartMax > 0 ? Math.min(100, (desired / chartMax) * 100) : 0;
                  return (
                    <div key={r.staffUserId} className="analytics-bar-chart__col">
                      <div className="analytics-bar-chart__bar-wrap">
                        <div
                          className="analytics-bar-chart__bar analytics-bar-chart__bar--desired"
                          style={{ height: `${hPct}%` }}
                          title={`${r.name}: ${desired}h desired`}
                        />
                      </div>
                      <span className="analytics-bar-chart__name">{r.name}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            <p className="analytics-card__footnote muted small">
              Average: {avgDesired.toFixed(1)}h desired per staff member. Gray bars = desired hours.
            </p>
          </>
        ) : null}
      </section>

      <section className="card analytics-card">
        <h2 className="analytics-card__title">Staff scheduling fairness</h2>
        {fairnessQuery.isLoading ? <p className="muted">Loading…</p> : null}
        {fairnessQuery.isError ? (
          <p className="text-error">We couldn’t load this table. Try again or pick another week.</p>
        ) : null}
        {!fairnessQuery.isLoading && !fairnessQuery.isError ? (
          <div className="table-wrap analytics-table-wrap">
            <table className="table analytics-table">
              <thead>
                <tr>
                  <th>Staff member</th>
                  <th className="analytics-table__num">Hours</th>
                  <th className="analytics-table__num">Desired</th>
                  <th className="analytics-table__num">Shifts</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const st = fairnessStatusLabel(r.scheduledHours, r.desiredHoursWeekly);
                  return (
                    <tr key={r.staffUserId}>
                      <td>{r.name}</td>
                      <td className="analytics-table__num">{r.scheduledHours.toFixed(1)}h</td>
                      <td className="analytics-table__num">
                        {r.desiredHoursWeekly != null ? `${r.desiredHoursWeekly}h` : "—"}
                      </td>
                      <td className="analytics-table__num">{r.shiftCount}</td>
                      <td>
                        {st === "none" ? (
                          <span className="muted">—</span>
                        ) : (
                          <span
                            className={`analytics-badge analytics-badge--${st === "match" ? "match" : st === "under" ? "under" : "over"}`}
                          >
                            {st === "under" ? "under" : st === "over" ? "over" : "on target"}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="card analytics-card analytics-card--chart">
        <h2 className="analytics-card__title">
          <span className="analytics-card__title-icon" aria-hidden>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          </span>
          Premium shift distribution (Fri/Sat evenings)
        </h2>
        {fairnessQuery.isLoading ? <p className="muted">Loading…</p> : null}
        {totalPremium === 0 && !fairnessQuery.isLoading ? (
          <p className="muted analytics-card__empty">No premium shifts in this period.</p>
        ) : null}
        {totalPremium > 0 ? (
          <div className="analytics-premium">
            {rows
              .filter((r) => r.premiumShiftCount > 0)
              .map((r) => (
                <div key={r.staffUserId} className="analytics-premium__row">
                  <span className="analytics-premium__name">{r.name}</span>
                  <div className="analytics-premium__bar-wrap">
                    <div
                      className="analytics-premium__bar"
                      style={{ width: `${(r.premiumShiftCount / maxPremiumCount) * 100}%` }}
                    />
                  </div>
                  <span className="analytics-premium__count">{r.premiumShiftCount}</span>
                </div>
              ))}
          </div>
        ) : null}
      </section>

      <section className="card analytics-card analytics-card--compact">
        <h2 className="analytics-card__title">Weekly hours & overtime signals</h2>
        {overtimeQuery.isLoading ? <p className="muted">Loading…</p> : null}
        {overtimeQuery.isError ? <p className="text-error">We couldn’t load overtime data.</p> : null}
        {!overtimeQuery.isLoading && !overtimeQuery.isError ? (
          <div className="table-wrap analytics-table-wrap">
            <table className="table analytics-table">
              <thead>
                <tr>
                  <th>Staff member</th>
                  <th className="analytics-table__num">Weekly hours</th>
                  <th>Warnings</th>
                </tr>
              </thead>
              <tbody>
                {(overtimeQuery.data ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={3} className="muted">
                      No assignments in this week for this scope.
                    </td>
                  </tr>
                ) : (
                  (overtimeQuery.data ?? []).map((r) => (
                    <tr key={r.staffUserId}>
                      <td>{r.name}</td>
                      <td className="analytics-table__num">{r.weeklyHours.toFixed(1)}h</td>
                      <td className="analytics-table__warnings">
                        {r.warnings.length === 0 ? (
                          <span className="muted">—</span>
                        ) : (
                          r.warnings.map((w) => (
                            <span key={w} className="analytics-badge analytics-badge--warn">
                              {w === "WEEKLY_WARN_35" ? "Near 40h" : w === "WEEKLY_WARN_40" ? "40h+" : w}
                            </span>
                          ))
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}
