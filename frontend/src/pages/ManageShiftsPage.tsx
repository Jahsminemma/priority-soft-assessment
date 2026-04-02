import { useCallback, useEffect, useId, useMemo, useState, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { useNavigate } from "react-router-dom";
import {
  createShift,
  deleteShift,
  fetchLocations,
  fetchShiftsManage,
  fetchSkills,
  fetchWeekScheduleState,
  updateShift,
} from "../api.js";
import { CreateShiftDialog } from "../components/CreateShiftDialog.js";
import { EditShiftDialog } from "../components/EditShiftDialog.js";
import { useAuth } from "../context/AuthContext.js";
import {
  compareIsoWeekKeys,
  normalizeIsoWeekKey,
  type ManageShiftRow,
  type ShiftDto,
  type WeekScheduleStateResponse,
} from "@shiftsync/shared";
import {
  buildMonFriShiftsUtc,
  formatWeekRangeCompactInZone,
  wallDateTimeToUtcIso,
  weekKeyMondayYmdInZone,
} from "../utils/scheduleTime.js";
import {
  addDaysYmd,
  initialWeekKeyFromToday,
  localDateStringToWeekKey,
  maxYmd,
  shiftWeekKey,
  todayLocalYmd,
  weekKeyToLocalMondayYmd,
} from "../utils/weekKey.js";

function isShiftPastCutoff(shift: ShiftDto, ws: WeekScheduleStateResponse | undefined): boolean {
  if (!ws || ws.weekRowStatus !== "PUBLISHED") return false;
  const ms = ws.cutoffHours * 60 * 60 * 1000;
  return Date.now() > new Date(shift.startAtUtc).getTime() - ms;
}

export default function ManageShiftsPage(): React.ReactElement {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canManage = user?.role === "ADMIN" || user?.role === "MANAGER";

  const [weekKey, setWeekKey] = useState(() => normalizeIsoWeekKey(initialWeekKeyFromToday()));
  const weekJumpId = useId();
  const [filterLocationId, setFilterLocationId] = useState("");
  const [createSkillId, setCreateSkillId] = useState("");
  const [createShiftOpen, setCreateShiftOpen] = useState(false);
  const [createShiftDayYmd, setCreateShiftDayYmd] = useState<string | null>(null);
  const [editShift, setEditShift] = useState<ShiftDto | null>(null);

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

  useEffect(() => {
    const skills = skillsQuery.data;
    if (!skills?.length || createSkillId) return;
    setCreateSkillId(skills[0]!.id);
  }, [skillsQuery.data, createSkillId]);

  const weekKeyNorm = normalizeIsoWeekKey(weekKey);

  const manageQuery = useQuery({
    queryKey: ["shifts", "manage", token, weekKeyNorm, filterLocationId],
    queryFn: ({ signal }) =>
      fetchShiftsManage(
        token!,
        {
          fromWeek: weekKeyNorm,
          toWeek: weekKeyNorm,
          ...(filterLocationId ? { locationId: filterLocationId } : {}),
        },
        signal,
      ),
    enabled: Boolean(canManage && token),
  });

  const rows = manageQuery.data ?? [];

  const tzByLocationId = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of locationsQuery.data ?? []) m.set(l.id, l.tzIana);
    return m;
  }, [locationsQuery.data]);

  const selectedLocationForCreate = useMemo(() => {
    const list = locationsQuery.data ?? [];
    if (filterLocationId) return list.find((l) => l.id === filterLocationId) ?? null;
    return list[0] ?? null;
  }, [locationsQuery.data, filterLocationId]);

  const locationTz = selectedLocationForCreate?.tzIana ?? "UTC";
  const nowInLocation = DateTime.now().setZone(locationTz);
  const todayInLocationYmd = nowInLocation.toFormat("yyyy-LL-dd");
  const minWeekKey = `${nowInLocation.weekYear}-W${String(nowInLocation.weekNumber).padStart(2, "0")}`;
  const createWeekKey = weekKeyNorm;

  const rangeCompact = useMemo(
    () => formatWeekRangeCompactInZone(weekKeyNorm, locationTz),
    [weekKeyNorm, locationTz],
  );
  const monYmd = useMemo(
    () => weekKeyMondayYmdInZone(weekKeyNorm, locationTz) ?? weekKeyToLocalMondayYmd(weekKeyNorm) ?? "",
    [weekKeyNorm, locationTz],
  );
  const atMinWeek = useMemo(() => compareIsoWeekKeys(weekKeyNorm, minWeekKey) <= 0, [weekKeyNorm, minWeekKey]);

  useEffect(() => {
    if (compareIsoWeekKeys(weekKeyNorm, minWeekKey) < 0) {
      setWeekKey(minWeekKey);
    }
  }, [weekKeyNorm, minWeekKey]);

  function goPrevWeek(): void {
    if (atMinWeek) return;
    const next = shiftWeekKey(weekKey, -1);
    if (next) setWeekKey(normalizeIsoWeekKey(next));
  }

  function goNextWeek(): void {
    const next = shiftWeekKey(weekKey, 1);
    if (next) setWeekKey(normalizeIsoWeekKey(next));
  }

  function onWeekJumpChange(e: ChangeEvent<HTMLInputElement>): void {
    const v = e.target.value;
    if (!v) return;
    let next = normalizeIsoWeekKey(localDateStringToWeekKey(v));
    if (compareIsoWeekKeys(next, minWeekKey) < 0) {
      next = minWeekKey;
    }
    setWeekKey(next);
  }

  function goToday(): void {
    let next = normalizeIsoWeekKey(localDateStringToWeekKey(todayLocalYmd()));
    if (compareIsoWeekKeys(next, minWeekKey) < 0) next = minWeekKey;
    setWeekKey(next);
  }

  const minShiftDateYmd = useMemo(() => {
    const mon = weekKeyMondayYmdInZone(createWeekKey, locationTz) ?? weekKeyToLocalMondayYmd(createWeekKey);
    if (!mon) return todayInLocationYmd;
    return maxYmd(mon, todayInLocationYmd);
  }, [createWeekKey, locationTz, todayInLocationYmd]);

  const weekStateForEditQuery = useQuery({
    queryKey: ["weekScheduleState", token, editShift?.locationId, editShift?.weekKey],
    queryFn: () =>
      fetchWeekScheduleState(token!, editShift!.locationId, normalizeIsoWeekKey(editShift!.weekKey)),
    enabled: Boolean(editShift && token),
  });

  const invalidateShifts = (): void => {
    void queryClient.invalidateQueries({ queryKey: ["shifts"] });
  };

  const invalidateScheduleWeek = (): void => {
    void queryClient.invalidateQueries({ queryKey: ["weekScheduleState"] });
  };

  const updateShiftMut = useMutation({
    mutationFn: (input: { shiftId: string; startAtUtc: string; endAtUtc: string; headcount: number }) => {
      const { shiftId, ...body } = input;
      return updateShift(token!, shiftId, body);
    },
    onSuccess: () => {
      invalidateShifts();
      invalidateScheduleWeek();
    },
  });

  const deleteShiftMut = useMutation({
    mutationFn: ({ emergencyOverrideReason }: { emergencyOverrideReason?: string }) => {
      if (!editShift) throw new Error("No shift selected");
      return deleteShift(token!, editShift.id, emergencyOverrideReason);
    },
    onSuccess: () => {
      invalidateShifts();
      invalidateScheduleWeek();
      setEditShift(null);
    },
  });

  const createShiftMut = useMutation({
    mutationFn: async (input: {
      requiredSkillId: string;
      headcount: number;
      isPremium: boolean;
      repeatMonFri: boolean;
      startDate: string;
      startTime: string;
      endDate: string;
      endTime: string;
    }) => {
      if (!selectedLocationForCreate) throw new Error("Choose a location first.");
      const locationId = selectedLocationForCreate.id;
      const weekKey = createWeekKey;
      if (input.repeatMonFri) {
        const slots = buildMonFriShiftsUtc(
          weekKey,
          input.startDate,
          input.endDate,
          input.startTime,
          input.endTime,
          locationTz,
          minShiftDateYmd,
        );
        for (const slot of slots) {
          await createShift(token!, {
            locationId,
            startAtUtc: slot.startAtUtc,
            endAtUtc: slot.endAtUtc,
            requiredSkillId: input.requiredSkillId,
            headcount: input.headcount,
            weekKey,
            isPremium: input.isPremium,
          });
        }
      } else {
        if (input.startDate < minShiftDateYmd || input.endDate < minShiftDateYmd) {
          throw new Error("Shift dates must be today or later (within the selected week).");
        }
        const startIso = wallDateTimeToUtcIso(input.startDate, input.startTime, locationTz);
        const endIso = wallDateTimeToUtcIso(input.endDate, input.endTime, locationTz);
        if (!startIso || !endIso) {
          throw new Error("Please set start and end using the date and time fields.");
        }
        if (new Date(endIso) <= new Date(startIso)) {
          throw new Error("End must be after start. For overnight shifts, set the end date to the next calendar day.");
        }
        await createShift(token!, {
          locationId,
          startAtUtc: startIso,
          endAtUtc: endIso,
          requiredSkillId: input.requiredSkillId,
          headcount: input.headcount,
          weekKey,
          isPremium: input.isPremium,
        });
      }
    },
    onSuccess: () => {
      invalidateShifts();
      invalidateScheduleWeek();
    },
  });

  const openCreateShift = useCallback(() => {
    const mon = weekKeyMondayYmdInZone(createWeekKey, locationTz) ?? weekKeyToLocalMondayYmd(createWeekKey);
    if (!mon) return;
    const sun = addDaysYmd(mon, 6);
    let d = maxYmd(mon, minShiftDateYmd);
    if (d > sun) d = sun;
    setCreateShiftDayYmd(d);
    setCreateShiftOpen(true);
  }, [createWeekKey, locationTz, minShiftDateYmd]);

  const goToScheduleAssign = useCallback(
    (shift: ManageShiftRow) => {
      const wk = normalizeIsoWeekKey(shift.weekKey);
      const params = new URLSearchParams({
        locationId: shift.locationId,
        weekKey: wk,
        focusShiftId: shift.id,
      });
      navigate(`/schedule?${params.toString()}`);
    },
    [navigate],
  );

  const editLocation = useMemo(
    () => locationsQuery.data?.find((l) => l.id === editShift?.locationId) ?? null,
    [locationsQuery.data, editShift?.locationId],
  );

  const editLocationTz = editLocation?.tzIana ?? "UTC";
  const editMinShiftDateYmd = useMemo(() => {
    if (!editShift) return todayInLocationYmd;
    const wk = normalizeIsoWeekKey(editShift.weekKey);
    const mon = weekKeyMondayYmdInZone(wk, editLocationTz) ?? weekKeyToLocalMondayYmd(wk);
    if (!mon) return todayInLocationYmd;
    const todayEdit = DateTime.now().setZone(editLocationTz).toFormat("yyyy-LL-dd");
    return maxYmd(mon, todayEdit);
  }, [editShift, editLocationTz]);

  if (!canManage) {
    return (
      <div className="page">
        <h1 className="page__title">Manage shifts</h1>
        <p className="muted">Only managers and admins can view this page.</p>
      </div>
    );
  }

  const locationsList = locationsQuery.data ?? [];
  const blockCreateWithoutFilter = locationsList.length > 1 && !filterLocationId;

  return (
    <div className="page manage-shifts-page">
      <h1 className="page__title">Manage shifts</h1>
      <p className="page__lead muted">
        Shifts for the selected week. Open the schedule to assign staff or edit on the calendar.
      </p>

      <div className="card schedule-cal-card manage-shifts-page__toolbar-card">
        <div className="schedule-cal__control-bar manage-shifts-page__control-bar">
          <div className="schedule-cal__header-left">
            <div className="schedule-cal__week-pill" role="group" aria-label="Week">
              <button
                type="button"
                className="schedule-cal__week-nav"
                aria-label="Previous week"
                disabled={atMinWeek}
                onClick={goPrevWeek}
              >
                ‹
              </button>
              <label htmlFor={weekJumpId} className="schedule-cal__week-range">
                {rangeCompact}
              </label>
              <input
                id={weekJumpId}
                type="date"
                className="visually-hidden"
                value={monYmd}
                min={weekKeyMondayYmdInZone(minWeekKey, locationTz) ?? weekKeyToLocalMondayYmd(minWeekKey) ?? undefined}
                onChange={onWeekJumpChange}
              />
              <button type="button" className="schedule-cal__week-nav" aria-label="Next week" onClick={goNextWeek}>
                ›
              </button>
            </div>
            <button type="button" className="schedule-cal__today-btn" onClick={goToday}>
              Today
            </button>
          </div>
          <div className="schedule-cal__header-right">
            <label className="schedule-cal__location-select-wrap">
              <span className="visually-hidden">Location</span>
              <select
                className="schedule-cal__location-select schedule-cal__location-select--header"
                value={filterLocationId}
                onChange={(e) => setFilterLocationId(e.target.value)}
                disabled={locationsQuery.isLoading || (locationsQuery.data ?? []).length === 0}
                title={locationTz ? `Times use ${locationTz} when filtering` : undefined}
              >
                <option value="">{user?.role === "ADMIN" ? "All locations" : "All my locations"}</option>
                {(locationsQuery.data ?? []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn btn--primary"
              disabled={blockCreateWithoutFilter || !selectedLocationForCreate || createShiftMut.isPending}
              title={
                blockCreateWithoutFilter
                  ? "Choose a location in the filters to create a shift at that site."
                  : undefined
              }
              onClick={() => openCreateShift()}
            >
              + New shift
            </button>
          </div>
        </div>
      </div>

      <div className="manage-shifts-page__list">
        {manageQuery.isLoading ? <p className="muted">Loading shifts…</p> : null}
        {manageQuery.isError ? <p className="text-error">Could not load shifts.</p> : null}
        {!manageQuery.isLoading && rows.length === 0 && manageQuery.isSuccess ? (
          <p className="muted card manage-shifts-page__empty">No shifts this week.</p>
        ) : null}

        {rows.map((shift) => (
          <article key={shift.id} className="manage-shifts-card">
            <div className="manage-shifts-card__top">
              <div className="manage-shifts-card__badges">
                <span
                  className={`manage-shifts-card__pill manage-shifts-card__pill--${shift.status === "PUBLISHED" ? "published" : "draft"}`}
                >
                  {shift.status === "PUBLISHED" ? "Published" : "Draft"}
                </span>
                {shift.isPremium ? (
                  <span className="manage-shifts-card__pill manage-shifts-card__pill--premium">★ Premium</span>
                ) : null}
              </div>
              <h2 className="manage-shifts-card__location">{shift.locationName}</h2>
            </div>
            <p className="manage-shifts-card__meta">
              <span className="manage-shifts-card__skill">
                {skillsQuery.data?.find((s) => s.id === shift.requiredSkillId)?.name ?? "Role"}
              </span>
              <span className="muted"> · </span>
              <span className="manage-shifts-card__time">
                {formatShiftRange(shift, tzByLocationId.get(shift.locationId) ?? "UTC")}
              </span>
            </p>
            <div className="manage-shifts-card__staff-row">
              <span className="manage-shifts-card__people-icon" aria-hidden>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
                </svg>
              </span>
              <span
                className={
                  shift.assignments.length >= shift.headcount
                    ? "manage-shifts-card__count"
                    : "manage-shifts-card__count manage-shifts-card__count--warn"
                }
              >
                {shift.assignments.length}/{shift.headcount} assigned
              </span>
            </div>
            {shift.assignments.length > 0 ? (
              <ul className="manage-shifts-card__chips">
                {shift.assignments.map((a) => (
                  <li key={a.assignmentId} className="manage-shifts-card__chip">
                    {a.staffName}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="manage-shifts-card__actions">
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => setEditShift(shift)}>
                Edit
              </button>
              <button type="button" className="btn btn--primary btn--sm" onClick={() => goToScheduleAssign(shift)}>
                + Assign staff
              </button>
            </div>
          </article>
        ))}
      </div>

      <EditShiftDialog
        open={Boolean(editShift)}
        onClose={() => setEditShift(null)}
        shift={editShift}
        location={editLocation}
        locationTz={editLocationTz}
        minShiftDateYmd={editMinShiftDateYmd}
        skills={skillsQuery.data ?? []}
        pending={updateShiftMut.isPending}
        error={updateShiftMut.isError && updateShiftMut.error instanceof Error ? updateShiftMut.error.message : null}
        deletePending={deleteShiftMut.isPending}
        deleteError={deleteShiftMut.isError && deleteShiftMut.error instanceof Error ? deleteShiftMut.error.message : null}
        pastCutoffLocked={Boolean(
          editShift && user?.role === "MANAGER" && weekStateForEditQuery.data && isShiftPastCutoff(editShift, weekStateForEditQuery.data),
        )}
        onSave={(input) =>
          updateShiftMut
            .mutateAsync({
              shiftId: editShift!.id,
              startAtUtc: input.startAtUtc,
              endAtUtc: input.endAtUtc,
              headcount: input.headcount,
              ...(input.emergencyOverrideReason ? { emergencyOverrideReason: input.emergencyOverrideReason } : {}),
            })
            .then(() => {})
        }
        onDelete={(input) => deleteShiftMut.mutateAsync(input).then(() => {})}
      />

      <CreateShiftDialog
        open={createShiftOpen}
        onClose={() => setCreateShiftOpen(false)}
        location={selectedLocationForCreate}
        locationTz={locationTz}
        minShiftDateYmd={minShiftDateYmd}
        skills={skillsQuery.data ?? []}
        defaultSkillId={createSkillId}
        defaultHeadcount={2}
        defaultIsPremium={false}
        dayYmd={createShiftDayYmd}
        pending={createShiftMut.isPending}
        error={createShiftMut.isError && createShiftMut.error instanceof Error ? createShiftMut.error.message : null}
        onCreate={(input) => createShiftMut.mutateAsync(input)}
      />
    </div>
  );
}

function formatShiftRange(shift: ManageShiftRow, fallbackTz: string): string {
  const tz = fallbackTz;
  const start = DateTime.fromISO(shift.startAtUtc, { zone: "utc" }).setZone(tz);
  const end = DateTime.fromISO(shift.endAtUtc, { zone: "utc" }).setZone(tz);
  if (!start.isValid || !end.isValid) return "";
  return `${start.toFormat("MMM d, h:mm a")} – ${end.toFormat("MMM d, h:mm a")}`;
}
