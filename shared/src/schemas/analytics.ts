import { z } from "zod";
import { normalizeIsoWeekKey } from "../weekKey.js";

export const LocationWeekQuerySchema = z.object({
  locationId: z.string().uuid(),
  weekKey: z.string().min(1).transform(normalizeIsoWeekKey),
});

export type LocationWeekQuery = z.infer<typeof LocationWeekQuerySchema>;

/** Single site, or aggregate across every location you can manage. */
export const AnalyticsLocationWeekQuerySchema = z.object({
  locationId: z.union([z.string().uuid(), z.literal("all")]),
  weekKey: z.string().min(1).transform(normalizeIsoWeekKey),
});

export type AnalyticsLocationWeekQuery = z.infer<typeof AnalyticsLocationWeekQuerySchema>;

export const OvertimeCostAssignmentRowSchema = z.object({
  assignmentId: z.string().uuid(),
  shiftId: z.string().uuid(),
  staffUserId: z.string().uuid(),
  staffName: z.string(),
  straightMinutes: z.number(),
  otMinutes: z.number(),
  straightUsd: z.number(),
  otUsd: z.number(),
  hourlyRateUsd: z.number(),
});

export const OvertimeCostStaffRowSchema = z.object({
  staffUserId: z.string().uuid(),
  name: z.string(),
  weeklyMinutes: z.number(),
  weeklyStraightMinutes: z.number(),
  weeklyOtMinutes: z.number(),
  straightUsd: z.number(),
  otUsd: z.number(),
  totalLaborUsd: z.number(),
});

export const OvertimeCostWeekResponseSchema = z.object({
  weekKey: z.string(),
  totalStraightUsd: z.number(),
  totalOtUsd: z.number(),
  totalLaborUsd: z.number(),
  staff: z.array(OvertimeCostStaffRowSchema),
  assignments: z.array(OvertimeCostAssignmentRowSchema),
});

export type OvertimeCostWeekResponse = z.infer<typeof OvertimeCostWeekResponseSchema>;
