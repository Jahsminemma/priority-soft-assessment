import { getIo } from "./io.server.js";

export function emitScheduleWeekUpdated(locationId: string, payload: { weekKey: string; status: string }): void {
  const s = getIo();
  if (!s) return;
  s.to(`location:${locationId}`).emit("schedule.weekUpdated", payload);
}

export function emitShiftUpdated(
  locationId: string,
  payload: { shiftId: string; action: "created" | "updated" | "deleted" },
): void {
  const s = getIo();
  if (!s) return;
  s.to(`location:${locationId}`).emit("shift.updated", payload);
}

export function emitAssignmentChanged(
  locationId: string,
  payload: { shiftId: string; staffUserId: string; assignmentId: string },
): void {
  const s = getIo();
  if (!s) return;
  s.to(`location:${locationId}`).emit("assignment.changed", payload);
}

export function emitAssignmentConflict(
  locationId: string,
  payload: { shiftId: string; message: string; rejectedUserId?: string },
): void {
  const s = getIo();
  if (!s) return;
  s.to(`location:${locationId}`).emit("conflict.assignmentRejected", payload);
}

export function emitCoverageUpdated(
  locationId: string,
  payload: { requestId: string; status: string; type: string },
): void {
  const s = getIo();
  if (!s) return;
  s.to(`location:${locationId}`).emit("coverage.requestUpdated", payload);
}

export function emitNotificationCreated(userId: string, payload: { notificationId: string; type: string }): void {
  const s = getIo();
  if (!s) return;
  s.to(`user:${userId}`).emit("notification.created", payload);
}

export function emitPresenceOnDutyUpdated(locationId: string, payload: { locationId: string }): void {
  const s = getIo();
  if (!s) return;
  s.to(`location:${locationId}`).emit("presence.onDutyUpdated", payload);
}
