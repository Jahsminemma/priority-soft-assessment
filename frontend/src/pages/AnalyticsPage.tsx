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
import { giniCoefficient, premiumFairnessScore } from "../utils/analyticsFairness.js";

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

function formatDeltaHours(scheduled: number, desired: number | null): string {
  if (desired == null) return "—";
  const d = Math.round((scheduled - desired) * 10) / 10;
  if (d === 0) return "0";
  return d > 0 ? `+${d}h` : `${d}h`;
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
    let m = 8;
    for (const r of rows) {
      if (r.desiredHoursWeekly != null) m = Math.max(m, r.desiredHoursWeekly);
      m = Math.max(m, r.scheduledHours);
    }
    return Math.ceil(m / 4) * 4 || 40;
  }, [rows]);

  const totalPremium = useMemo(() => rows.reduce((s, r) => s + r.premiumShiftCount, 0), [rows]);

  const maxPremiumCount = useMemo(() => Math.max(1, ...rows.map((r) => r.premiumShiftCount)), [rows]);

  const rosterSize = rows.length;
  const equalPremiumShare = rosterSize > 0 ? totalPremium / rosterSize : 0;

  const premiumFairness = useMemo(() => {
    if (rows.length === 0) return { score: null as number | null, gini: null as number | null };
    const counts = rows.map((r) => r.premiumShiftCount);
    return {
      score: premiumFairnessScore(counts),
      gini: giniCoefficient(counts),
    };
  }, [rows]);

  const timeRangeLabel =
    timePreset === "last-week"
      ? "Last week"
      : timePreset === "this-week"
        ? "This week"
        : formatWeekRangeCompact(weekKey);

  if (!canManage) {
    return (
      <div className="page">
        <h1 className="page__title">Schedule fairness analytics</h1>
        <div className="card">
          <p className="muted">These reports are for managers and admins. Ask your administrator if you need access.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page analytics-page">
      <header className="analytics-page__header">
        <div>
          <h1 className="page__title analytics-page__title">Schedule fairness analytics</h1>
          <p className="page__lead muted analytics-page__lead">
            Hours assigned per person, desirable (premium) shift distribution, and how each staff member compares to
            their stated weekly hours goal.
          </p>
        </div>
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
            <span className="field__label">Period</span>
            <select value={timePreset} onChange={(e) => setTimePreset(e.target.value as TimePreset)}>
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

      <section className="card analytics-card analytics-card--highlight" aria-labelledby="analytics-fairness-score-heading">
        <h2 id="analytics-fairness-score-heading" className="analytics-card__title">
          <span className="analytics-card__title-icon" aria-hidden>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          </span>
          Premium shift fairness
        </h2>
        {fairnessQuery.isLoading ? <p className="muted">Loading…</p> : null}
        {!fairnessQuery.isLoading && !fairnessQuery.isError && totalPremium === 0 ? (
          <p className="muted analytics-card__empty">
            No desirable / premium shifts in <strong>{timeRangeLabel}</strong> (Fri/Sat evening starts, or shifts marked
            Premium in the schedule).
          </p>
        ) : null}
        {!fairnessQuery.isLoading && !fairnessQuery.isError && totalPremium > 0 && rosterSize > 0 ? (
          <div className="analytics-fairness-score">
            <div className="analytics-fairness-score__main">
              <span className="analytics-fairness-score__value" aria-live="polite">
                {premiumFairness.score != null ? `${premiumFairness.score}` : "—"}
              </span>
              <span className="analytics-fairness-score__suffix">/ 100</span>
            </div>
            <p className="analytics-fairness-score__explain muted small">
              Fairness score from how evenly <strong>desirable shifts</strong> are spread across the roster (100 = equal
              share for everyone). Based on {totalPremium} premium shift{totalPremium === 1 ? "" : "s"} and {rosterSize}{" "}
              staff in scope; equal share ≈ {equalPremiumShare.toFixed(2)} each.
              {premiumFairness.gini != null ? (
                <>
                  {" "}
                  Inequality (Gini): {premiumFairness.gini.toFixed(2)} (0 = fair, 1 = one person has all).
                </>
              ) : null}
            </p>
          </div>
        ) : null}
        {fairnessQuery.isError ? <p className="text-error">We couldn’t load fairness data.</p> : null}
      </section>

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
          Hours assigned vs desired ({timeRangeLabel})
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
            <div className="analytics-bar-legend" aria-hidden>
              <span className="analytics-bar-legend__item">
                <span className="analytics-bar-legend__swatch analytics-bar-legend__swatch--scheduled" /> Assigned
              </span>
              <span className="analytics-bar-legend__item">
                <span className="analytics-bar-legend__swatch analytics-bar-legend__swatch--desired" /> Desired weekly
              </span>
            </div>
            <div className="analytics-bar-chart" role="img" aria-label="Assigned and desired hours per staff member">
              <div className="analytics-bar-chart__y-axis" aria-hidden>
                {[0, 0.25, 0.5, 0.75, 1].map((t) => (
                  <span key={t} className="analytics-bar-chart__tick">
                    {Math.round(chartMax * (1 - t))}
                  </span>
                ))}
              </div>
              <div className="analytics-bar-chart__plot">
                {rows.map((r) => {
                  const schPct = chartMax > 0 ? Math.min(100, (r.scheduledHours / chartMax) * 100) : 0;
                  const des = r.desiredHoursWeekly ?? 0;
                  const desPct = chartMax > 0 ? Math.min(100, (des / chartMax) * 100) : 0;
                  return (
                    <div key={r.staffUserId} className="analytics-bar-chart__col">
                      <div className="analytics-bar-chart__bar-wrap">
                        <div className="analytics-bar-chart__pair">
                          <div
                            className="analytics-bar-chart__bar analytics-bar-chart__bar--scheduled"
                            style={{ height: `${schPct}%` }}
                            title={`${r.name}: ${r.scheduledHours.toFixed(1)}h assigned`}
                          />
                          <div
                            className="analytics-bar-chart__bar analytics-bar-chart__bar--desired"
                            style={{ height: `${desPct}%` }}
                            title={`${r.name}: ${r.desiredHoursWeekly != null ? `${des}h desired` : "no desired hours set"}`}
                          />
                        </div>
                      </div>
                      <span className="analytics-bar-chart__name">{r.name}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            <p className="analytics-card__footnote muted small">
              <strong>Assigned</strong> = scheduled hours in the period. <strong>Desired</strong> = each person’s weekly
              hours goal (from their profile).
            </p>
          </>
        ) : null}
      </section>

      <section className="card analytics-card analytics-card--callout" aria-labelledby="analytics-premium-def-heading">
        <h2 id="analytics-premium-def-heading" className="analytics-card__title">
          What counts as a “desirable” (premium) shift?
        </h2>
        <ul className="analytics-callout-list">
          <li>
            <strong>Friday or Saturday evening</strong> (shift <em>start</em> at the site’s local time, 5:00 p.m. or
            later), or
          </li>
          <li>
            Any shift explicitly marked <strong>Premium</strong> when building the schedule (covers custom peak slots).
          </li>
        </ul>
        <p className="muted small analytics-callout-list__foot">
          Fairness compares how many of these shifts each person received versus an equal split across everyone in this
          report.
        </p>
      </section>

      <section className="card analytics-card">
        <h2 className="analytics-card__title">Fairness detail by staff member</h2>
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
                  <th className="analytics-table__num">Assigned (h)</th>
                  <th className="analytics-table__num">Desired (h)</th>
                  <th className="analytics-table__num">Δ vs desired</th>
                  <th className="analytics-table__num">Shifts</th>
                  <th className="analytics-table__num">Premium shifts</th>
                  <th className="analytics-table__num" title="Versus equal share of premium shifts">
                    Premium Δ vs fair
                  </th>
                  <th>Load vs goal</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const st = fairnessStatusLabel(r.scheduledHours, r.desiredHoursWeekly);
                  return (
                    <tr key={r.staffUserId}>
                      <td>{r.name}</td>
                      <td className="analytics-table__num">{r.scheduledHours.toFixed(1)}</td>
                      <td className="analytics-table__num">
                        {r.desiredHoursWeekly != null ? r.desiredHoursWeekly.toFixed(1) : "—"}
                      </td>
                      <td className="analytics-table__num">{formatDeltaHours(r.scheduledHours, r.desiredHoursWeekly)}</td>
                      <td className="analytics-table__num">{r.shiftCount}</td>
                      <td className="analytics-table__num">{r.premiumShiftCount}</td>
                      <td className="analytics-table__num">
                        {totalPremium > 0 ? (
                          <span
                            title={`Fair share ≈ ${equalPremiumShare.toFixed(2)} premium shifts`}
                            className={
                              Math.abs(r.premiumDeltaVsEqualShare) < 0.05 ? "analytics-table__delta--neutral" : ""
                            }
                          >
                            {r.premiumDeltaVsEqualShare > 0 ? "+" : ""}
                            {r.premiumDeltaVsEqualShare.toFixed(2)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        {st === "none" ? (
                          <span className="muted">No goal set</span>
                        ) : (
                          <span
                            className={`analytics-badge analytics-badge--${st === "match" ? "match" : st === "under" ? "under" : "over"}`}
                          >
                            {st === "under" ? "Under-scheduled" : st === "over" ? "Over-scheduled" : "On target"}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="muted small analytics-table-hint">
              <strong>Δ vs desired</strong> = assigned minus stated weekly hours. <strong>Premium Δ vs fair</strong> =
              difference from an equal split of desirable shifts (positive = more than fair share).
            </p>
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
          Premium shifts received ({timeRangeLabel})
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
        <h2 className="analytics-card__title">Weekly hours and overtime signals</h2>
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
