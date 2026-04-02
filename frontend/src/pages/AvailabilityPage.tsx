import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addMyAvailabilityExceptionsBatch,
  deleteMyAvailabilityException,
  fetchLocations,
  fetchMyAvailability,
  replaceMyAvailabilityRules,
} from "../api.js";
import { formatAvailabilityExceptionRange } from "../utils/scheduleTime.js";
import { FeedbackModal, messageFromError } from "../components/FeedbackModal.js";
import { useAuth } from "../context/AuthContext.js";

const LOAD_ERROR_TITLE = "Couldn’t load availability";

type FeedbackState = { variant: "success" | "error"; title: string; message: string } | null;

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

type DayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;
const DAY_INDICES: readonly DayIndex[] = [0, 1, 2, 3, 4, 5, 6];

type DayWindow = { start: string; end: string };

function emptyWeek(): Record<DayIndex, DayWindow[]> {
  return { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
}

function toHHmm(s: string): string {
  const t = s.trim();
  if (t.length >= 5) return t.slice(0, 5);
  return t;
}

function groupRulesIntoWeek(
  rules: Array<{ dayOfWeek: number; startLocalTime: string; endLocalTime: string }>,
): Record<DayIndex, DayWindow[]> {
  const w = emptyWeek();
  for (const r of rules) {
    const d = r.dayOfWeek;
    if (d < 0 || d > 6) continue;
    const di = d as DayIndex;
    w[di].push({ start: toHHmm(r.startLocalTime), end: toHHmm(r.endLocalTime) });
  }
  return w;
}

function minutesFromHHmm(hhmm: string): number {
  const parts = hhmm.split(":");
  const h = parseInt(parts[0] ?? "", 10);
  const m = parseInt(parts[1] ?? "", 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return NaN;
  return h * 60 + m;
}

function weekToRulesPayload(week: Record<DayIndex, DayWindow[]>): Array<{
  dayOfWeek: number;
  startLocalTime: string;
  endLocalTime: string;
}> {
  const rules: Array<{ dayOfWeek: number; startLocalTime: string; endLocalTime: string }> = [];
  for (const d of DAY_INDICES) {
    for (const win of week[d]) {
      rules.push({
        dayOfWeek: d,
        startLocalTime: win.start,
        endLocalTime: win.end,
      });
    }
  }
  return rules;
}

function validateWeek(week: Record<DayIndex, DayWindow[]>): string | null {
  for (const d of DAY_INDICES) {
    for (const win of week[d]) {
      const a = minutesFromHHmm(win.start);
      const b = minutesFromHHmm(win.end);
      if (Number.isNaN(a) || Number.isNaN(b)) return `Invalid time on ${DAY_LABELS[d]}.`;
      if (b <= a) return `On ${DAY_LABELS[d]}, end time must be after start time (same calendar day).`;
    }
  }
  return null;
}

function locationNameForStoredTz(
  tz: string | null | undefined,
  locations: Array<{ name: string; tzIana: string }> | undefined,
): string | null {
  if (!tz || !locations?.length) return null;
  const match = locations.find((l) => l.tzIana === tz);
  return match?.name ?? null;
}

export default function AvailabilityPage(): React.ReactElement {
  const { token, user } = useAuth();
  const queryClient = useQueryClient();
  const [week, setWeek] = useState<Record<DayIndex, DayWindow[]>>(() => emptyWeek());
  const [feedback, setFeedback] = useState<FeedbackState>(null);

  const [exStartLocal, setExStartLocal] = useState("");
  const [exEndLocal, setExEndLocal] = useState("");
  const [exType, setExType] = useState<"UNAVAILABLE" | "AVAILABLE_OVERRIDE">("UNAVAILABLE");
  /** Certified locations this exception applies to (one API call; server derives UTC per site). */
  const [selectedExceptionLocIds, setSelectedExceptionLocIds] = useState<string[]>([]);
  const didInitExceptionLocs = useRef(false);

  const locationsQuery = useQuery({
    queryKey: ["locations", token],
    queryFn: () => fetchLocations(token!),
    enabled: Boolean(token) && user?.role === "STAFF",
  });

  const availabilityQuery = useQuery({
    queryKey: ["myAvailability", token],
    queryFn: () => fetchMyAvailability(token!),
    enabled: Boolean(token) && user?.role === "STAFF",
    refetchOnWindowFocus: false,
  });

  const applyLoadedRules = useCallback(() => {
    const data = availabilityQuery.data;
    if (!data) return;
    setWeek(groupRulesIntoWeek(data.rules));
  }, [availabilityQuery.data]);

  useEffect(() => {
    applyLoadedRules();
  }, [applyLoadedRules]);

  useEffect(() => {
    const list = locationsQuery.data;
    if (!list?.length) return;
    setSelectedExceptionLocIds((prev) => {
      const valid = prev.filter((id) => list.some((l) => l.id === id));
      if (!didInitExceptionLocs.current) {
        didInitExceptionLocs.current = true;
        return list.map((l) => l.id);
      }
      return valid;
    });
  }, [locationsQuery.data]);

  const fallbackTimeZone = useMemo(
    () => locationsQuery.data?.[0]?.tzIana ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    [locationsQuery.data],
  );

  useEffect(() => {
    if (availabilityQuery.isError) {
      setFeedback({
        variant: "error",
        title: LOAD_ERROR_TITLE,
        message: "Check your connection and refresh the page, or try again later.",
      });
    }
  }, [availabilityQuery.isError]);

  useEffect(() => {
    if (availabilityQuery.data && feedback?.title === LOAD_ERROR_TITLE) {
      setFeedback(null);
    }
  }, [availabilityQuery.data, feedback]);

  const closeFeedback = useCallback(() => {
    setFeedback(null);
  }, []);

  const saveRulesMut = useMutation({
    mutationFn: async () => {
      const err = validateWeek(week);
      if (err) throw new Error(err);
      await replaceMyAvailabilityRules(token!, { rules: weekToRulesPayload(week) });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["myAvailability"] });
      setFeedback({
        variant: "success",
        title: "Success",
        message: "Weekly pattern saved.",
      });
    },
    onError: (err) => {
      setFeedback({
        variant: "error",
        title: "Couldn’t save weekly pattern",
        message: messageFromError(err, "Check your times and try again."),
      });
    },
  });

  const addExceptionMut = useMutation({
    mutationFn: async (): Promise<{ ids: string[] }> => {
      if (!exStartLocal || !exEndLocal) {
        throw new Error("Choose start and end for the exception.");
      }
      if (selectedExceptionLocIds.length === 0) {
        throw new Error("Select at least one location.");
      }
      return addMyAvailabilityExceptionsBatch(token!, {
        startLocal: exStartLocal,
        endLocal: exEndLocal,
        type: exType,
        locationIds: selectedExceptionLocIds,
      });
    },
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ["myAvailability"] });
      setExStartLocal("");
      setExEndLocal("");
      setExType("UNAVAILABLE");
      const n = data.ids.length;
      setFeedback({
        variant: "success",
        title: "Success",
        message: n === 0 ? "Nothing to add." : n === 1 ? "Exception added." : `${n} exceptions added.`,
      });
    },
    onError: (err) => {
      setFeedback({
        variant: "error",
        title: "Couldn’t add exception",
        message: messageFromError(err, "Check the range and try again."),
      });
    },
  });

  const deleteExceptionMut = useMutation({
    mutationFn: (id: string) => deleteMyAvailabilityException(token!, id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["myAvailability"] });
      setFeedback({
        variant: "success",
        title: "Success",
        message: "Exception removed.",
      });
    },
    onError: (err) => {
      setFeedback({
        variant: "error",
        title: "Couldn’t remove exception",
        message: messageFromError(err, "Try again."),
      });
    },
  });

  const sortedExceptions = useMemo(() => {
    const list = availabilityQuery.data?.exceptions ?? [];
    return [...list].sort((a, b) => a.startAtUtc.localeCompare(b.startAtUtc));
  }, [availabilityQuery.data?.exceptions]);

  const isInitialLoad = availabilityQuery.isLoading;
  const isBackgroundRefresh =
    availabilityQuery.isFetching &&
    !availabilityQuery.isLoading &&
    !saveRulesMut.isPending &&
    !addExceptionMut.isPending &&
    !deleteExceptionMut.isPending;
  const weeklyBusy = saveRulesMut.isPending;
  const formLocked = isInitialLoad || weeklyBusy;

  if (user && user.role !== "STAFF") {
    return <Navigate to="/settings" replace />;
  }

  return (
    <div className="page">
      <h1 className="page__title">My availability</h1>
      <p className="page__lead muted">
        Set your usual weekly hours and one-off exceptions. Times for the weekly grid are{" "}
        <strong>local clock times</strong> (no timezone stored per rule—use the same convention you and your manager
        expect).         For each <strong>exception</strong>, choose one or more <strong>locations</strong> (same wall times apply per
        site’s clock). One save sends a single request for every location you check.
      </p>

      {isBackgroundRefresh ? (
        <p className="availability-page-status muted" role="status" aria-live="polite">
          Refreshing from server…
        </p>
      ) : null}

      <div className={`card stack availability-card${formLocked ? " availability-card--busy" : ""}`}>
        <h2 className="card__title">Weekly pattern</h2>
        <p className="field-hint">
          Add one or more windows per day. Days with no windows count as unavailable for scheduling that day.
        </p>

        {isInitialLoad ? (
          <div className="availability-loading" role="status" aria-live="polite" aria-busy="true">
            <span className="availability-loading__spinner" aria-hidden />
            <span>Loading your availability from the server…</span>
          </div>
        ) : null}

        {availabilityQuery.isError && !isInitialLoad && !feedback ? (
          <p className="text-error">Could not load your availability. Refresh the page.</p>
        ) : null}

        {weeklyBusy ? (
          <p className="availability-sync muted" role="status" aria-live="polite">
            Saving weekly pattern…
          </p>
        ) : null}

        {!isInitialLoad && !availabilityQuery.isError ? (
        <div className="availability-week">
          {DAY_INDICES.map((day) => {
            const label = DAY_LABELS[day];
            return (
            <div key={day} className="availability-day">
              <div className="availability-day__label">{label}</div>
              <div className="availability-day__windows">
                {week[day].length === 0 ? (
                  <span className="muted availability-day__empty">No windows — unavailable</span>
                ) : (
                  week[day].map((win, idx) => (
                    <div key={`${day}-${idx}`} className="availability-window-row">
                      <input
                        type="time"
                        className="availability-time"
                        disabled={formLocked}
                        value={win.start}
                        onChange={(e) => {
                          const v = e.target.value;
                          setWeek((prev) => {
                            const next = { ...prev, [day]: [...prev[day]] };
                            const row = next[day][idx];
                            if (!row) return next;
                            next[day][idx] = { ...row, start: v };
                            return next;
                          });
                        }}
                        aria-label={`${label} start`}
                      />
                      <span className="availability-window-row__sep">–</span>
                      <input
                        type="time"
                        className="availability-time"
                        disabled={formLocked}
                        value={win.end}
                        onChange={(e) => {
                          const v = e.target.value;
                          setWeek((prev) => {
                            const next = { ...prev, [day]: [...prev[day]] };
                            const row = next[day][idx];
                            if (!row) return next;
                            next[day][idx] = { ...row, end: v };
                            return next;
                          });
                        }}
                        aria-label={`${label} end`}
                      />
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={formLocked}
                        onClick={() => {
                          setWeek((prev) => {
                            const next = { ...prev, [day]: prev[day].filter((_, i) => i !== idx) };
                            return next;
                          });
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  ))
                )}
                <button
                  type="button"
                  className="btn btn--ghost btn--sm availability-add-window"
                  disabled={formLocked}
                  onClick={() => {
                    setWeek((prev) => ({
                      ...prev,
                      [day]: [...prev[day], { start: "09:00", end: "17:00" }],
                    }));
                  }}
                >
                  Add window
                </button>
              </div>
            </div>
            );
          })}
        </div>
        ) : null}

        <div className="availability-actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={weeklyBusy || isInitialLoad || availabilityQuery.isError}
            onClick={() => void saveRulesMut.mutateAsync()}
          >
            {weeklyBusy ? "Saving…" : "Save weekly pattern"}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={isInitialLoad || weeklyBusy}
            onClick={() => applyLoadedRules()}
          >
            Reset to saved
          </button>
        </div>
      </div>

      <div className="card stack">
        <h2 className="card__title">Exceptions</h2>
        <p className="field-hint">
          Check every <strong>location</strong> this block applies to, then set type and times. Start/end are
          interpreted in <strong>each</strong> site’s local timezone (same as the schedule).
        </p>

        {isInitialLoad ? (
          <div className="availability-loading availability-loading--inline" role="status" aria-live="polite">
            <span className="availability-loading__spinner" aria-hidden />
            <span>Loading exceptions…</span>
          </div>
        ) : null}

        {addExceptionMut.isPending ? (
          <p className="availability-sync muted" role="status" aria-live="polite">
            Sending to server…
          </p>
        ) : null}

        <div className="availability-exception-form">
          {locationsQuery.data && locationsQuery.data.length > 0 ? (
            <div className="field availability-locations-field">
              <span className="field__label">Locations</span>
              <div className="availability-location-actions">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={isInitialLoad || addExceptionMut.isPending}
                  onClick={() => {
                    const list = locationsQuery.data;
                    if (list?.length) setSelectedExceptionLocIds(list.map((l) => l.id));
                  }}
                >
                  Select all
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={isInitialLoad || addExceptionMut.isPending}
                  onClick={() => setSelectedExceptionLocIds([])}
                >
                  Clear
                </button>
              </div>
              <ul className="availability-location-checkboxes" role="group" aria-label="Locations for this exception">
                {locationsQuery.data.map((loc) => (
                  <li key={loc.id}>
                    <label className="availability-location-checkboxes__row">
                      <input
                        type="checkbox"
                        checked={selectedExceptionLocIds.includes(loc.id)}
                        disabled={isInitialLoad || addExceptionMut.isPending}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setSelectedExceptionLocIds((prev) =>
                            checked ? [...prev, loc.id] : prev.filter((id) => id !== loc.id),
                          );
                        }}
                      />
                      <span title={`${loc.tzIana} — wall times below use this site’s local clock`}>{loc.name}</span>
                      <span className="muted availability-location-checkboxes__tz">{loc.tzIana}</span>
                    </label>
                  </li>
                ))}
              </ul>
              <span className="field-hint">
                Each checked site gets this exception (same calendar times in that site’s zone). Sites that share a
                timezone are stored once on the server.
              </span>
            </div>
          ) : locationsQuery.isSuccess ? (
            <p className="field-hint muted">
              No certified locations yet. Exception times use your device timezone (
              {Intl.DateTimeFormat().resolvedOptions().timeZone}) until you are certified for a location.
            </p>
          ) : null}
          <label className="field">
            <span className="field__label">Type</span>
            <select
              value={exType}
              disabled={isInitialLoad || addExceptionMut.isPending}
              onChange={(e) => setExType(e.target.value as typeof exType)}
            >
              <option value="UNAVAILABLE">Unavailable</option>
              <option value="AVAILABLE_OVERRIDE">Available override</option>
            </select>
          </label>
          <label className="field">
            <span className="field__label">Start (local time at location)</span>
            <input
              type="datetime-local"
              value={exStartLocal}
              disabled={isInitialLoad || addExceptionMut.isPending}
              onChange={(e) => setExStartLocal(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field__label">End (local time at location)</span>
            <input
              type="datetime-local"
              value={exEndLocal}
              disabled={isInitialLoad || addExceptionMut.isPending}
              onChange={(e) => setExEndLocal(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn btn--primary"
            disabled={
              isInitialLoad ||
              addExceptionMut.isPending ||
              !(locationsQuery.data?.length) ||
              selectedExceptionLocIds.length === 0
            }
            onClick={() => void addExceptionMut.mutateAsync()}
          >
            {addExceptionMut.isPending ? "Adding…" : "Add exception"}
          </button>
        </div>
        {sortedExceptions.length === 0 ? (
          <p className="muted">No exceptions yet.</p>
        ) : (
          <ul className="availability-exception-list">
            {sortedExceptions.map((ex) => {
              const exLocName = locationNameForStoredTz(ex.tzIana, locationsQuery.data);
              return (
              <li key={ex.id} className="availability-exception-list__item">
                <div>
                  <strong>
                    {ex.type === "UNAVAILABLE" ? "Unavailable" : "Available override"}
                    {exLocName ? <> · {exLocName}</> : null}
                  </strong>
                  <div className="muted availability-exception-list__range">
                    {formatAvailabilityExceptionRange(
                      ex.startAtUtc,
                      ex.endAtUtc,
                      ex.tzIana ?? fallbackTimeZone,
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={deleteExceptionMut.isPending}
                  onClick={() => void deleteExceptionMut.mutateAsync(ex.id)}
                >
                  {deleteExceptionMut.isPending && deleteExceptionMut.variables === ex.id ? "Removing…" : "Delete"}
                </button>
              </li>
            );
            })}
          </ul>
        )}
      </div>

      <FeedbackModal
        open={feedback !== null}
        variant={feedback?.variant ?? "success"}
        title={feedback?.title ?? ""}
        message={feedback?.message ?? ""}
        onClose={closeFeedback}
      />
    </div>
  );
}
