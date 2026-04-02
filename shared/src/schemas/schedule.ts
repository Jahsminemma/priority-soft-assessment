import { z } from "zod";
import { EMERGENCY_OVERRIDE_MIN_LEN } from "../emergency.js";
import { normalizeIsoWeekKey } from "../weekKey.js";

export const PublishWeekRequestSchema = z.object({
  locationId: z.string().uuid(),
  weekKey: z.string().min(1).transform(normalizeIsoWeekKey),
  cutoffHours: z.number().int().min(1).max(168).optional(),
});

export type PublishWeekRequest = z.infer<typeof PublishWeekRequestSchema>;

export const UnpublishWeekRequestSchema = z.object({
  locationId: z.string().uuid(),
  weekKey: z.string().min(1).transform(normalizeIsoWeekKey),
  emergencyOverrideReason: z
    .string()
    .trim()
    .min(EMERGENCY_OVERRIDE_MIN_LEN)
    .max(2000)
    .optional(),
});

export type UnpublishWeekRequest = z.infer<typeof UnpublishWeekRequestSchema>;

export const WeekScheduleStateQuerySchema = z.object({
  locationId: z.string().uuid(),
  weekKey: z.string().min(1).transform(normalizeIsoWeekKey),
});

export type WeekScheduleStateQuery = z.infer<typeof WeekScheduleStateQuerySchema>;

export const WeekScheduleStateResponseSchema = z.object({
  weekKey: z.string(),
  cutoffHours: z.number().int(),
  /** Row may be absent until first publish. */
  weekRowStatus: z.enum(["NONE", "DRAFT", "PUBLISHED"]),
  /** True if any published shift in this week is past the per-shift edit deadline (now > start − cutoff). */
  anyShiftLocked: z.boolean(),
  /**
   * True when this week is already published and nothing has changed since the last publish
   * (no shift/assignment edits tracked). Unpublishing or making changes enables publish again.
   */
  publishDisabled: z.boolean(),
});

export type WeekScheduleStateResponse = z.infer<typeof WeekScheduleStateResponseSchema>;
