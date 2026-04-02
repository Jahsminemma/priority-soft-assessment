/** One assignment row from GET /api/shifts/:id/assignments (used by schedule UI). */
export type ShiftAssignmentRow = {
  assignmentId: string;
  staffUserId: string;
  staffName: string;
  staffEmail: string;
};
