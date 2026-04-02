/** Dispatched when the server broadcasts `conflict.assignmentRejected` (concurrent assignment race). */
export const ASSIGNMENT_CONFLICT_EVENT = "shiftsync:assignment-conflict";

export type AssignmentConflictDetail = {
  shiftId: string;
  message: string;
  /** Present when another manager’s commit won; that manager should not see the toast (they already get the HTTP error). */
  rejectedUserId?: string;
};

export function dispatchAssignmentConflict(detail: AssignmentConflictDetail): void {
  window.dispatchEvent(new CustomEvent(ASSIGNMENT_CONFLICT_EVENT, { detail }));
}
