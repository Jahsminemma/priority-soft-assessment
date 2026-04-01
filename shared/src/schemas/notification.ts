import { z } from "zod";

export const NotificationDtoSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  payload: z.unknown(),
  readAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});

export type NotificationDto = z.infer<typeof NotificationDtoSchema>;
