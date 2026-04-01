import { z } from "zod";
import { normalizeIsoWeekKey } from "../weekKey.js";

export const LocationWeekQuerySchema = z.object({
  locationId: z.string().uuid(),
  weekKey: z.string().min(1).transform(normalizeIsoWeekKey),
});

export type LocationWeekQuery = z.infer<typeof LocationWeekQuerySchema>;
