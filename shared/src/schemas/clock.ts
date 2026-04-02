import { z } from "zod";

export const ClockInRequestSchema = z.object({
  shiftId: z.string().uuid(),
});

export type ClockInRequest = z.infer<typeof ClockInRequestSchema>;

export const ClockInCodeRequestSchema = z.object({
  shiftId: z.string().uuid(),
});

export type ClockInCodeRequest = z.infer<typeof ClockInCodeRequestSchema>;

export const ClockInCodeResponseSchema = z.object({
  code: z.string(),
  expiresAtUtc: z.string(),
});

export type ClockInCodeResponse = z.infer<typeof ClockInCodeResponseSchema>;

export const ClockSessionHistoryRowSchema = z.object({
  sessionId: z.string().uuid(),
  shiftId: z.string().uuid().nullable(),
  locationId: z.string().uuid().nullable(),
  locationName: z.string().nullable(),
  tzIana: z.string().nullable(),
  clockInAtUtc: z.string(),
  clockOutAtUtc: z.string().nullable(),
});

export type ClockSessionHistoryRow = z.infer<typeof ClockSessionHistoryRowSchema>;
