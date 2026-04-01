import { z } from "zod";

export const LocationWeekQuerySchema = z.object({
  locationId: z.string().uuid(),
  weekKey: z.string().min(1),
});

export type LocationWeekQuery = z.infer<typeof LocationWeekQuerySchema>;
