import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { io } from "socket.io-client";
import { useAuth } from "../context/AuthContext.js";
import { fetchLocations } from "../api.js";
import { dispatchAssignmentConflict, type AssignmentConflictDetail } from "../utils/realtimeEvents.js";

/**
 * Subscribes to Socket.IO and invalidates React Query caches when server events fire.
 */
export function useSocketSync(): void {
  const { token, user } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!token || !user) return;

    let cancelled = false;
    const socket = io({ path: "/socket.io", auth: { token } });

    void (async () => {
      try {
        const locs = await fetchLocations(token);
        if (cancelled) return;
        const ids = locs.map((l) => l.id);
        socket.emit("subscribe:locations", ids, () => {
          /* ack */
        });
      } catch {
        /* locations may fail if token expired */
      }
    })();

    const invShifts = (): void => {
      void queryClient.invalidateQueries({ queryKey: ["shifts"] });
      // Ensure any mounted staff/manager schedule views update immediately.
      void queryClient.refetchQueries({ queryKey: ["shifts"], type: "active" });
    };
    const invShiftsAndWeekState = (): void => {
      invShifts();
      void queryClient.invalidateQueries({ queryKey: ["weekScheduleState"] });
      void queryClient.refetchQueries({ queryKey: ["weekScheduleState"], type: "active" });
      void queryClient.invalidateQueries({ queryKey: ["analytics", "overtimeCost"] });
    };
    const invCoverage = (): void => {
      invShiftsAndWeekState();
      void queryClient.invalidateQueries({ queryKey: ["swapCandidates"] });
      void queryClient.refetchQueries({ queryKey: ["swapCandidates"], type: "active" });
      void queryClient.invalidateQueries({ queryKey: ["managerCoverageQueue"] });
      void queryClient.refetchQueries({ queryKey: ["managerCoverageQueue"], type: "active" });
      void queryClient.invalidateQueries({ queryKey: ["openCallouts"] });
      void queryClient.refetchQueries({ queryKey: ["openCallouts"], type: "active" });
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      void queryClient.refetchQueries({ queryKey: ["notifications"], type: "active" });
    };
    socket.on("schedule.weekUpdated", invShiftsAndWeekState);
    socket.on("shift.updated", invShiftsAndWeekState);
    socket.on("assignment.changed", invShiftsAndWeekState);
    socket.on("conflict.assignmentRejected", (payload: unknown) => {
      invShifts();
      void queryClient.invalidateQueries({ queryKey: ["shiftAssignments"] });
      void queryClient.refetchQueries({ queryKey: ["shiftAssignments"], type: "active" });
      const parsed = payload as Partial<AssignmentConflictDetail> | undefined;
      if (parsed && typeof parsed.shiftId === "string" && typeof parsed.message === "string") {
        dispatchAssignmentConflict({
          shiftId: parsed.shiftId,
          message: parsed.message,
          ...(typeof parsed.rejectedUserId === "string" ? { rejectedUserId: parsed.rejectedUserId } : {}),
        });
      }
    });
    socket.on("coverage.requestUpdated", invCoverage);
    socket.on("notification.created", () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      void queryClient.refetchQueries({ queryKey: ["notifications"], type: "active" });
    });
    socket.on("presence.onDutyUpdated", () => {
      void queryClient.invalidateQueries({ queryKey: ["onDuty"] });
    });

    return () => {
      cancelled = true;
      socket.disconnect();
    };
  }, [token, user, queryClient]);
}
