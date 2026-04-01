import { z } from "zod";

export const AvailabilityRuleInputSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startLocalTime: z.string().min(1),
  endLocalTime: z.string().min(1),
});

export const ReplaceAvailabilityRulesSchema = z.object({
  rules: z.array(AvailabilityRuleInputSchema),
});

export type ReplaceAvailabilityRules = z.infer<typeof ReplaceAvailabilityRulesSchema>;

export const AvailabilityExceptionInputSchema = z.object({
  startAtUtc: z.string().datetime(),
  endAtUtc: z.string().datetime(),
  type: z.enum(["UNAVAILABLE", "AVAILABLE_OVERRIDE"]),
  /** Wall times above were interpreted in this zone (same as work location when set). */
  tzIana: z.string().min(1).optional(),
});

export type AvailabilityExceptionInput = z.infer<typeof AvailabilityExceptionInputSchema>;

/** One request: same wall-time range applied to each certified location (UTC derived per site timezone). */
export const AvailabilityExceptionBatchInputSchema = z.object({
  /** `datetime-local` string interpreted per location (YYYY-MM-DDTHH:mm…). */
  startLocal: z.string().min(1),
  endLocal: z.string().min(1),
  type: z.enum(["UNAVAILABLE", "AVAILABLE_OVERRIDE"]),
  locationIds: z.array(z.string().uuid()).min(1),
});

export type AvailabilityExceptionBatchInput = z.infer<typeof AvailabilityExceptionBatchInputSchema>;

export const NotificationPrefsSchema = z.object({
  inApp: z.boolean().optional(),
  emailSimulated: z.boolean().optional(),
});

export type NotificationPrefs = z.infer<typeof NotificationPrefsSchema>;
