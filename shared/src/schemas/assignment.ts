import { z } from "zod";

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
]);

export type ConstraintViolationCode = z.infer<typeof ConstraintViolationCodeSchema>;

export const ConstraintViolationSchema = z.object({
  code: ConstraintViolationCodeSchema,
  message: z.string(),
  severity: z.enum(["hard", "warn"]),
});

export type ConstraintViolation = z.infer<typeof ConstraintViolationSchema>;

export const AssignmentPreviewRequestSchema = z.object({
  shiftId: z.string().uuid(),
  staffUserId: z.string().uuid(),
});

export type AssignmentPreviewRequest = z.infer<typeof AssignmentPreviewRequestSchema>;

export const StaffAlternativeSchema = z.object({
  staffUserId: z.string().uuid(),
  name: z.string(),
  reason: z.string(),
});

export const AssignmentPreviewResponseSchema = z.object({
  ok: z.boolean(),
  hardViolations: z.array(ConstraintViolationSchema),
  warnings: z.array(ConstraintViolationSchema),
  alternatives: z.array(StaffAlternativeSchema),
});

export type AssignmentPreviewResponse = z.infer<typeof AssignmentPreviewResponseSchema>;

export const AssignmentCommitRequestSchema = z.object({
  shiftId: z.string().uuid(),
  staffUserId: z.string().uuid(),
  idempotencyKey: z.string().min(8).max(128),
  seventhDayOverrideReason: z.string().optional(),
});

export type AssignmentCommitRequest = z.infer<typeof AssignmentCommitRequestSchema>;

export const AssignmentCommitResponseSchema = z.object({
  success: z.boolean(),
  assignmentId: z.string().uuid().optional(),
  hardViolations: z.array(ConstraintViolationSchema),
  warnings: z.array(ConstraintViolationSchema),
  conflict: z.boolean().optional(),
  message: z.string().optional(),
});

export type AssignmentCommitResponse = z.infer<typeof AssignmentCommitResponseSchema>;
