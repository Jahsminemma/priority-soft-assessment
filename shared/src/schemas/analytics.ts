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
