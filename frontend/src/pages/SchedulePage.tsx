import { useEffect, useMemo, useState } from "react";
import { DateTime } from "luxon";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createShift,
  deleteShift,
  deleteAssignment,
  fetchLocations,
  fetchRosterCandidates,
  fetchShiftAssignments,
  fetchShifts,
  fetchSkills,
  fetchWeekScheduleState,
  publishWeek,
  unpublishWeek,
  updateShift,
} from "../api.js";
import { ScheduleCellAssignDialog } from "../components/ScheduleCellAssignDialog.js";
import { CreateShiftDialog } from "../components/CreateShiftDialog.js";
import { EditShiftDialog } from "../components/EditShiftDialog.js";
import { FeedbackModal } from "../components/FeedbackModal.js";
import { ScheduleWeekCalendar, type StaffRosterRow } from "../components/ScheduleWeekCalendar.js";
import { useAuth } from "../context/AuthContext.js";
import {
  compareIsoWeekKeys,
  EMERGENCY_OVERRIDE_MIN_LEN,
  normalizeIsoWeekKey,
  type ShiftDto,
  type WeekScheduleStateResponse,
} from "@shiftsync/shared";
import {
  buildMonFriShiftsUtc,
  isoWeekDayKeysInLocationZone,
  utcIsoToLocalYmd,
  wallDateTimeToUtcIso,
  weekKeyMondayYmdInZone,
} from "../utils/scheduleTime.js";
import {
  addDaysYmd,
  initialWeekKeyFromToday,
  maxYmd,
  weekKeyToLocalMondayYmd,
} from "../utils/weekKey.js";

function isShiftPastCutoff(shift: ShiftDto, ws: WeekScheduleStateResponse | undefined): boolean {
  if (!ws || ws.weekRowStatus !== "PUBLISHED") return false;
  const ms = ws.cutoffHours * 60 * 60 * 1000;
  return Date.now() > new Date(shift.startAtUtc).getTime() - ms;
}

export default function SchedulePage(): React.ReactElement {
  const { token, user } = useAuth();
  const canManage = user?.role === "ADMIN" || user?.role === "MANAGER";
  const queryClient = useQueryClient();
  const [locationId, setLocationId] = useState("");
  const [weekKey, setWeekKey] = useState(() => normalizeIsoWeekKey(initialWeekKeyFromToday()));
  const [createSkillId, setCreateSkillId] = useState("");
  const [assignCell, setAssignCell] = useState<{
    staff: StaffRosterRow;
    dayYmd: string;
    initialShiftId?: string;
  } | null>(null);
  const [createShiftDayYmd, setCreateShiftDayYmd] = useState<string | null>(null);
  const [createShiftOpen, setCreateShiftOpen] = useState(false);
  const [editShift, setEditShift] = useState<ShiftDto | null>(null);
  const [unpublishModalOpen, setUnpublishModalOpen] = useState(false);
  const [unpublishEmergencyReason, setUnpublishEmergencyReason] = useState("");
  const [publishSuccessInfo, setPublishSuccessInfo] = useState<{
    weekKey: string;
    siteName: string;
  } | null>(null);
  const [removeAssignmentModalId, setRemoveAssignmentModalId] = useState<string | null>(null);
  const [removeEmergencyReason, setRemoveEmergencyReason] = useState("");

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

  const skillIds = useMemo(() => skillsQuery.data?.map((s) => s.id) ?? [], [skillsQuery.data]);
  const skillNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of skillsQuery.data ?? []) m.set(s.id, s.name);
    return m;
  }, [skillsQuery.data]);

  const rosterQueries = useQueries({
    queries: skillIds.map((skillId) => ({
      queryKey: ["rosterCandidates", token, locationId, skillId] as const,
      queryFn: () => fetchRosterCandidates(token!, locationId!, skillId),
      enabled: Boolean(canManage && token && locationId && skillIds.length > 0),
    })),
  });
  const rosterLoading = rosterQueries.some((q) => q.isPending);
  const staffRows = useMemo(() => {
    const m = new Map<string, { id: string; name: string; skillIds: Set<string> }>();
    for (let i = 0; i < skillIds.length; i++) {
      const sk = skillIds[i]!;
      const rows = rosterQueries[i]?.data ?? [];
      for (const r of rows) {
        const ex = m.get(r.id);
        if (ex) ex.skillIds.add(sk);
        else m.set(r.id, { id: r.id, name: r.name, skillIds: new Set([sk]) });
      }
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [rosterQueries, skillIds]);

  useEffect(() => {
    const list = locationsQuery.data;
    if (!list?.length || locationId) return;
    setLocationId(list[0]!.id);
  }, [locationsQuery.data, locationId]);

  useEffect(() => {
    const skills = skillsQuery.data;
    if (!skills?.length || createSkillId) return;
    setCreateSkillId(skills[0]!.id);
  }, [skillsQuery.data, createSkillId]);

  const selectedLocation = useMemo(
    () => locationsQuery.data?.find((l) => l.id === locationId),
    [locationsQuery.data, locationId],
  );
  const locationTz = selectedLocation?.tzIana ?? "UTC";

  const nowInLocation = DateTime.now().setZone(locationTz);
  const todayInLocationYmd = nowInLocation.toFormat("yyyy-LL-dd");
  const minWeekKey = `${nowInLocation.weekYear}-W${String(nowInLocation.weekNumber).padStart(2, "0")}`;
  const minShiftDateYmd = useMemo(() => {
    const mon = weekKeyMondayYmdInZone(weekKey, locationTz) ?? weekKeyToLocalMondayYmd(weekKey);
    if (!mon) return todayInLocationYmd;
    return maxYmd(mon, todayInLocationYmd);
  }, [weekKey, locationTz, todayInLocationYmd]);

  useEffect(() => {
    if (compareIsoWeekKeys(weekKey, minWeekKey) < 0) {
      setWeekKey(minWeekKey);
    }
  }, [weekKey, minWeekKey]);

  const openCreateShiftForDay = (ymd: string): void => {
    const mon = weekKeyMondayYmdInZone(weekKey, locationTz) ?? weekKeyToLocalMondayYmd(weekKey);
    if (!mon) return;
    const sun = addDaysYmd(mon, 6);
    let d = ymd;
    if (d < mon) d = mon;
    if (d > sun) d = sun;
    d = maxYmd(d, minShiftDateYmd);
    setCreateShiftDayYmd(d);
    setCreateShiftOpen(true);
  };

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

  const weekStateQuery = useQuery({
    queryKey: ["weekScheduleState", token, locationId, weekKeyNorm],
    queryFn: () => fetchWeekScheduleState(token!, locationId, weekKeyNorm),
    enabled: Boolean(canManage && token && locationId && weekKey),
    staleTime: 0,
    refetchOnMount: "always",
  });

  const shiftsList = shiftsQuery.data ?? [];

  /**
   * Treat "this week" membership by *actual* local start date, not by `shift.weekKey`.
   * If `shift.weekKey` is inconsistent with `startAtUtc`, the schedule otherwise looks shifted.
   */
  const weekDayKeysInZone = useMemo(
    () => new Set(isoWeekDayKeysInLocationZone(weekKeyNorm, locationTz)),
    [weekKeyNorm, locationTz],
  );
  const shiftsForSelectedWeek = useMemo(
    () => shiftsList.filter((s) => weekDayKeysInZone.has(utcIsoToLocalYmd(s.startAtUtc, locationTz))),
    [shiftsList, weekDayKeysInZone, locationTz],
  );

  /** Week-state can briefly show the previous fetch while the new week loads; shifts are filtered by weekKey above. */
  const weekStateMatchesSelection =
    weekStateQuery.data != null && weekStateQuery.data.weekKey === weekKeyNorm;
  const scheduleQueriesSettledForSelectedWeek =
    weekStateMatchesSelection && !weekStateQuery.isFetching;

  /** Same rule as edit/assign dialogs (`isShiftPastCutoff`), not only server `anyShiftLocked`. */
  const weekHasCutoffLocked = useMemo(() => {
    const ws = weekStateQuery.data;
    if (!ws || ws.weekKey !== weekKeyNorm) return false;
    return shiftsForSelectedWeek.some((s) => isShiftPastCutoff(s, ws));
  }, [shiftsForSelectedWeek, weekStateQuery.data, weekKeyNorm]);

  const showCutoffLockBanner =
    scheduleQueriesSettledForSelectedWeek && user?.role === "MANAGER" && weekHasCutoffLocked;

  const assignmentQueries = useQueries({
    queries: shiftsForSelectedWeek.map((s) => ({
      queryKey: ["shiftAssignments", token, s.id] as const,
      queryFn: () => fetchShiftAssignments(token!, s.id),
      enabled: Boolean(canManage && token && s.id),
    })),
  });
  const assignmentsPerShift = assignmentQueries.map((q) => q.data);
  const assignmentsLoading = assignmentQueries.some((q) => q.isPending);

  const invalidateShifts = (): void => {
    void queryClient.invalidateQueries({ queryKey: ["shifts"] });
  };

  const invalidateShiftsAndAssignments = (): void => {
    void queryClient.invalidateQueries({ queryKey: ["shifts"] });
    void queryClient.invalidateQueries({ queryKey: ["shiftAssignments"] });
  };

  const invalidateScheduleWeek = (): void => {
    void queryClient.invalidateQueries({ queryKey: ["weekScheduleState"] });
  };

  const removeAssignmentMut = useMutation({
    mutationFn: ({ assignmentId, emergencyOverrideReason }: { assignmentId: string; emergencyOverrideReason?: string }) =>
      deleteAssignment(token!, assignmentId, emergencyOverrideReason),
    onSuccess: () => {
      invalidateShiftsAndAssignments();
      invalidateScheduleWeek();
      setRemoveAssignmentModalId(null);
      setRemoveEmergencyReason("");
    },
  });

  const updateShiftMut = useMutation({
    mutationFn: (input: { shiftId: string; startAtUtc: string; endAtUtc: string; headcount: number }) => {
      const { shiftId, ...body } = input;
      return updateShift(token!, shiftId, body);
    },
    onSuccess: () => {
      invalidateShiftsAndAssignments();
      invalidateScheduleWeek();
    },
  });

  const deleteShiftMut = useMutation({
    mutationFn: ({ emergencyOverrideReason }: { emergencyOverrideReason?: string }) => {
      if (!editShift) throw new Error("No shift selected");
      return deleteShift(token!, editShift.id, emergencyOverrideReason);
    },
    onSuccess: () => {
      invalidateShiftsAndAssignments();
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
      if (!locationId) throw new Error("Choose a location first.");
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

  const publishMut = useMutation({
    mutationFn: (args: { locationId: string; weekKey: string; siteName: string }) =>
      publishWeek(token!, { locationId: args.locationId, weekKey: args.weekKey }).then((res) => ({
        ...res,
        siteName: args.siteName,
      })),
    onSuccess: (data) => {
      invalidateShifts();
      invalidateScheduleWeek();
      setPublishSuccessInfo({ weekKey: data.weekKey, siteName: data.siteName });
    },
  });

  const unpublishMut = useMutation({
    mutationFn: (emergencyOverrideReason?: string) =>
      unpublishWeek(token!, {
        locationId,
        weekKey,
        ...(emergencyOverrideReason !== undefined && emergencyOverrideReason.trim().length > 0
          ? { emergencyOverrideReason: emergencyOverrideReason.trim() }
          : {}),
      }),
    onSuccess: () => {
      invalidateShifts();
      invalidateScheduleWeek();
      // Make the UI flip from PUBLISHED -> DRAFT immediately without requiring a full page reload.
      void shiftsQuery.refetch();
      void weekStateQuery.refetch();
      setUnpublishModalOpen(false);
      setUnpublishEmergencyReason("");
    },
  });

  if (!canManage) {
    return (
      <div className="page">
        <h1 className="page__title">Schedule & shifts</h1>
        <div className="card">
          <p className="muted">Only managers and admins can change the schedule. If you need access, ask your administrator.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <FeedbackModal
        open={publishSuccessInfo !== null}
        variant="success"
        title="Week published"
        message={
          publishSuccessInfo
            ? `${publishSuccessInfo.siteName} — ${publishSuccessInfo.weekKey} is now live. Assigned staff can see these shifts in My schedule.`
            : ""
        }
        onClose={() => setPublishSuccessInfo(null)}
      />
      <h1 className="page__title">Schedule & shifts</h1>
      <p className="page__lead muted">
        Choose location and week in the calendar header, add shifts from a day column, and assign people from a staff
        cell (<strong>+</strong>).
      </p>

      {scheduleQueriesSettledForSelectedWeek &&
      weekStateQuery.data?.weekRowStatus === "PUBLISHED" &&
      !weekHasCutoffLocked ? (
        <div className="card schedule-week-banner schedule-week-banner--ok">
          <p className="schedule-week-banner__text">
            You can freely edit or unpublish this schedule — all shifts are still outside the edit cutoff window.
          </p>
        </div>
      ) : null}

      {showCutoffLockBanner ? (
        <div className="card schedule-week-banner schedule-week-banner--warn">
          <p className="schedule-week-banner__text">
            This schedule is <strong>locked</strong> for shifts within the configured cutoff (default: 48 hours before
            start). For urgent changes, document an <strong>emergency override reason</strong> in the dialogs below, use{" "}
            <strong>Notifications</strong> (coverage actions), or ask an administrator.
          </p>
        </div>
      ) : null}

      <ScheduleWeekCalendar
        locations={locationsQuery.data ?? []}
        locationId={locationId}
        onLocationChange={setLocationId}
        locationsLoading={locationsQuery.isLoading}
        weekKey={weekKey}
        onWeekKeyChange={setWeekKey}
        minWeekKey={minWeekKey}
        locationTz={locationTz}
        shifts={shiftsForSelectedWeek}
        assignmentsPerShift={assignmentsPerShift}
        assignmentsLoading={assignmentsLoading}
        skillNameById={skillNameById}
        staffRows={staffRows}
        rosterLoading={rosterLoading}
        onDayAddShift={(ymd) => openCreateShiftForDay(ymd)}
        onCellAssign={(staff, dayYmd) => setAssignCell({ staff, dayYmd })}
        onRemoveAssignment={(assignmentId) => {
          if (weekHasCutoffLocked && user?.role === "MANAGER") {
            setRemoveEmergencyReason("");
            setRemoveAssignmentModalId(assignmentId);
            return;
          }
          void removeAssignmentMut.mutateAsync({ assignmentId });
        }}
        removeAssignmentPending={removeAssignmentMut.isPending}
        onEditShift={(s) => setEditShift(s)}
        headerActions={
          <div className="btn-row schedule-publish-actions">
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={!locationId || unpublishMut.isPending}
              onClick={() => {
                if (weekHasCutoffLocked && user?.role === "MANAGER") {
                  setUnpublishEmergencyReason("");
                  setUnpublishModalOpen(true);
                  return;
                }
                void unpublishMut.mutateAsync(undefined);
              }}
            >
              {unpublishMut.isPending ? "Unpublishing…" : "Unpublish week"}
            </button>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={
                !locationId ||
                publishMut.isPending ||
                weekStateQuery.data?.publishDisabled === true
              }
              title={
                weekStateQuery.data?.publishDisabled === true
                  ? "This week is already published. Change shifts or assignments, or unpublish, before publishing again."
                  : undefined
              }
              onClick={() =>
                void publishMut.mutateAsync({
                  locationId,
                  weekKey,
                  siteName: selectedLocation?.name ?? "This site",
                })
              }
            >
              {publishMut.isPending ? "Publishing…" : "Publish week"}
            </button>
          </div>
        }
      />

      <EditShiftDialog
        open={Boolean(editShift)}
        onClose={() => setEditShift(null)}
        shift={editShift}
        location={selectedLocation ?? null}
        locationTz={locationTz}
        minShiftDateYmd={minShiftDateYmd}
        skills={skillsQuery.data ?? []}
        pending={updateShiftMut.isPending}
        error={updateShiftMut.isError && updateShiftMut.error instanceof Error ? updateShiftMut.error.message : null}
        deletePending={deleteShiftMut.isPending}
        deleteError={deleteShiftMut.isError && deleteShiftMut.error instanceof Error ? deleteShiftMut.error.message : null}
        pastCutoffLocked={
          Boolean(
            editShift &&
              user?.role === "MANAGER" &&
              weekStateQuery.data &&
              isShiftPastCutoff(editShift, weekStateQuery.data),
          )
        }
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
        onDelete={(input) =>
          deleteShiftMut
            .mutateAsync(input)
            .then(() => {})
        }
      />

      <CreateShiftDialog
        open={createShiftOpen}
        onClose={() => setCreateShiftOpen(false)}
        location={selectedLocation ?? null}
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

      {assignCell ? (
        <ScheduleCellAssignDialog
          open
          onClose={() => setAssignCell(null)}
          token={token!}
          staffUserId={assignCell.staff.id}
          staffName={assignCell.staff.name}
          staffSkillIds={assignCell.staff.skillIds}
          dayYmd={assignCell.dayYmd}
          locationTz={locationTz}
          shifts={shiftsForSelectedWeek}
          assignmentsPerShift={assignmentsPerShift}
          skillNameById={skillNameById}
          staffRows={staffRows}
          onAddShiftForDay={(ymd) => {
            openCreateShiftForDay(ymd);
            setAssignCell(null);
          }}
          {...(assignCell.initialShiftId ? { initialShiftId: assignCell.initialShiftId } : {})}
          scheduleCutoff={
            weekStateQuery.data
              ? {
                  cutoffHours: weekStateQuery.data.cutoffHours,
                  weekRowStatus: weekStateQuery.data.weekRowStatus,
                }
              : null
          }
        />
      ) : null}

      {unpublishModalOpen ? (
        <div className="schedule-modal-root" role="presentation">
          <button
            type="button"
            className="schedule-modal-backdrop"
            aria-label="Close"
            onClick={() => setUnpublishModalOpen(false)}
          />
          <div className="schedule-modal schedule-modal--narrow" role="dialog" aria-modal="true">
            <h2 className="schedule-modal__title">Unpublish week (emergency)</h2>
            <p className="muted small">
              At least one shift is inside the edit cutoff. Enter a reason to unpublish (staff will be notified).
            </p>
            <label className="field">
              <span className="field__label">Emergency reason</span>
              <textarea
                value={unpublishEmergencyReason}
                onChange={(e) => setUnpublishEmergencyReason(e.target.value)}
                rows={4}
                placeholder="Minimum 10 characters"
              />
            </label>
            <div className="btn-row">
              <button type="button" className="btn btn--secondary" onClick={() => setUnpublishModalOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={
                  unpublishMut.isPending ||
                  unpublishEmergencyReason.trim().length < EMERGENCY_OVERRIDE_MIN_LEN
                }
                onClick={() => void unpublishMut.mutateAsync(unpublishEmergencyReason)}
              >
                {unpublishMut.isPending ? "Unpublishing…" : "Confirm unpublish"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {removeAssignmentModalId ? (
        <div className="schedule-modal-root" role="presentation">
          <button
            type="button"
            className="schedule-modal-backdrop"
            aria-label="Close"
            onClick={() => setRemoveAssignmentModalId(null)}
          />
          <div className="schedule-modal schedule-modal--narrow" role="dialog" aria-modal="true">
            <h2 className="schedule-modal__title">Remove assignment (emergency)</h2>
            <p className="muted small">This week has shifts inside the edit cutoff. Document why you are removing staff.</p>
            <label className="field">
              <span className="field__label">Emergency reason</span>
              <textarea
                value={removeEmergencyReason}
                onChange={(e) => setRemoveEmergencyReason(e.target.value)}
                rows={4}
                placeholder="Minimum 10 characters"
              />
            </label>
            <div className="btn-row">
              <button type="button" className="btn btn--secondary" onClick={() => setRemoveAssignmentModalId(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={
                  removeAssignmentMut.isPending ||
                  removeEmergencyReason.trim().length < EMERGENCY_OVERRIDE_MIN_LEN ||
                  !removeAssignmentModalId
                }
                onClick={() => {
                  if (!removeAssignmentModalId) return;
                  void removeAssignmentMut.mutateAsync({
                    assignmentId: removeAssignmentModalId,
                    emergencyOverrideReason: removeEmergencyReason.trim(),
                  });
                }}
              >
                {removeAssignmentMut.isPending ? "Removing…" : "Remove assignment"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
