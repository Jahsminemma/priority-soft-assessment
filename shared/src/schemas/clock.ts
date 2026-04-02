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

export const ClockCodeLookupSchema = z.object({
  code: z.string().min(1).max(32),
});

export type ClockCodeLookup = z.infer<typeof ClockCodeLookupSchema>;

export const ClockCodePreviewResponseSchema = z.object({
  staff: z.object({
    id: z.string().uuid(),
    name: z.string(),
    email: z.string().email(),
  }),
  shift: z.object({
    id: z.string().uuid(),
    startAtUtc: z.string(),
    endAtUtc: z.string(),
  }),
  location: z.object({
    id: z.string().uuid(),
    name: z.string(),
    tzIana: z.string(),
  }),
  skillName: z.string(),
  expiresAtUtc: z.string(),
  managerLocationWarning: z.string().nullable(),
  shiftLocationId: z.string().uuid(),
});

export type ClockCodePreviewResponse = z.infer<typeof ClockCodePreviewResponseSchema>;

export const ClockApproveCodeResponseSchema = z.object({
  sessionId: z.string().uuid(),
});

export type ClockApproveCodeResponse = z.infer<typeof ClockApproveCodeResponseSchema>;
