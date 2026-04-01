import { z } from "zod";

export const PublishWeekRequestSchema = z.object({
  locationId: z.string().uuid(),
  weekKey: z.string().min(1),
  cutoffHours: z.number().int().min(1).max(168).optional(),
});

export type PublishWeekRequest = z.infer<typeof PublishWeekRequestSchema>;

export const UnpublishWeekRequestSchema = z.object({
  locationId: z.string().uuid(),
  weekKey: z.string().min(1),
});

export type UnpublishWeekRequest = z.infer<typeof UnpublishWeekRequestSchema>;
