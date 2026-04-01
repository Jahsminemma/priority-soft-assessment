import { z } from "zod";

export const ClockInRequestSchema = z.object({
  shiftId: z.string().uuid(),
});

export type ClockInRequest = z.infer<typeof ClockInRequestSchema>;
