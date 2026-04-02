import { z } from "zod";
import { EMERGENCY_OVERRIDE_MIN_LEN } from "../emergency.js";

export const ConstraintViolationCodeSchema = z.enum([
  "DOUBLE_BOOK",
  "REST_10H",
  "MISSING_SKILL",
  "NOT_CERTIFIED",
  "OUTSIDE_AVAILABILITY",
  "DAILY_HARD_12H",
  "DAILY_WARN_8H",
  "WEEKLY_WARN_35",
  "WEEKLY_WARN_40",
  "CONSECUTIVE_SIXTH_DAY",
  "WEEKLY_SEVENTH_DAY",
  /** 7th consecutive day allowed because a manager supplied a documented override (preview/commit warning). */
  "WEEKLY_SEVENTH_DAY_OVERRIDE",
  /** Shift already has assignments equal to headcount. */
  "HEADCOUNT_FULL",
  /** Preview/commit target shift does not exist (or was removed). */
  "SHIFT_NOT_FOUND",
  /** Published week: past the location’s edit cutoff before this shift. */
  "SCHEDULE_CUTOFF",
]);

export type ConstraintViolationCode = z.infer<typeof ConstraintViolationCodeSchema>;

/** Short, stable labels for UI — which policy is being enforced. */
export const CONSTRAINT_RULE_TITLES: Record<ConstraintViolationCode, string> = {
  DOUBLE_BOOK: "One shift at a time",
  REST_10H: "Minimum rest between shifts",
  MISSING_SKILL: "Required skill",
  NOT_CERTIFIED: "Location certification",
  OUTSIDE_AVAILABILITY: "Availability & time off",
  DAILY_HARD_12H: "Daily hours limit",
  DAILY_WARN_8H: "Long day warning",
  WEEKLY_WARN_35: "Weekly hours (approaching 40)",
  WEEKLY_WARN_40: "Weekly hours (overtime risk)",
  CONSECUTIVE_SIXTH_DAY: "Consecutive work days",
  WEEKLY_SEVENTH_DAY: "Seventh day in a row",
  WEEKLY_SEVENTH_DAY_OVERRIDE: "Seventh day — manager override",
  HEADCOUNT_FULL: "Shift is fully staffed",
  SHIFT_NOT_FOUND: "Shift not found",
  SCHEDULE_CUTOFF: "Schedule edit window closed",
};

export const ConstraintViolationSchema = z.object({
  code: ConstraintViolationCodeSchema,
  /** Human-readable explanation: what went wrong for this assignment attempt. */
  message: z.string(),
  severity: z.enum(["hard", "warn"]),
});

export type ConstraintViolation = z.infer<typeof ConstraintViolationSchema>;

const emergencyOverrideField = z
  .string()
  .trim()
  .min(EMERGENCY_OVERRIDE_MIN_LEN)
  .max(2000)
  .optional();

export const AssignmentPreviewRequestSchema = z.object({
  shiftId: z.string().uuid(),
  staffUserId: z.string().uuid(),
  emergencyOverrideReason: emergencyOverrideField,
  seventhDayOverrideReason: z.string().optional(),
});

export type AssignmentPreviewRequest = z.infer<typeof AssignmentPreviewRequestSchema>;

export const StaffAlternativeSchema = z.object({
  staffUserId: z.string().uuid(),
  name: z.string(),
  reason: z.string(),
});

export type StaffAlternative = z.infer<typeof StaffAlternativeSchema>;

/** Weekly OT projection for this site/week if this assignment is added (FIFO by shift start, 40h straight cap). */
export const AssignmentLaborImpactSchema = z.object({
  hourlyRateUsd: z.number(),
  weeklyBaselineMinutes: z.number(),
  weeklyAfterMinutes: z.number(),
  hypotheticalShiftStraightMinutes: z.number(),
  hypotheticalShiftOtMinutes: z.number(),
  baselineLaborUsd: z.number(),
  projectedLaborUsd: z.number(),
  deltaLaborUsd: z.number(),
});

export type AssignmentLaborImpact = z.infer<typeof AssignmentLaborImpactSchema>;

export const AssignmentPreviewResponseSchema = z.object({
  ok: z.boolean(),
  hardViolations: z.array(ConstraintViolationSchema),
  warnings: z.array(ConstraintViolationSchema),
  /** Staff who pass all checks — safe to assign. */
  alternatives: z.array(StaffAlternativeSchema),
  /**
   * Other staff with the required skill and location cert who still cannot be assigned,
   * with a concise reason (which rule blocks them). Helps compare options when the first pick fails.
   */
  ineligibleCandidates: z.array(StaffAlternativeSchema),
  laborImpact: AssignmentLaborImpactSchema.optional(),
});

export type AssignmentPreviewResponse = z.infer<typeof AssignmentPreviewResponseSchema>;

export const AssignmentCommitRequestSchema = z.object({
  shiftId: z.string().uuid(),
  staffUserId: z.string().uuid(),
  idempotencyKey: z.string().min(8).max(128),
  seventhDayOverrideReason: z.string().optional(),
  emergencyOverrideReason: emergencyOverrideField,
});

export type AssignmentCommitRequest = z.infer<typeof AssignmentCommitRequestSchema>;

export const AssignmentCommitResponseSchema = z.object({
  success: z.boolean(),
  assignmentId: z.string().uuid().optional(),
  hardViolations: z.array(ConstraintViolationSchema),
  warnings: z.array(ConstraintViolationSchema),
  conflict: z.boolean().optional(),
  message: z.string().optional(),
  /** Present when success is false — same shape as assignment preview. */
  alternatives: z.array(StaffAlternativeSchema).optional(),
  ineligibleCandidates: z.array(StaffAlternativeSchema).optional(),
});

export type AssignmentCommitResponse = z.infer<typeof AssignmentCommitResponseSchema>;
