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
});

export type AvailabilityExceptionInput = z.infer<typeof AvailabilityExceptionInputSchema>;

export const NotificationPrefsSchema = z.object({
  inApp: z.boolean().optional(),
  emailSimulated: z.boolean().optional(),
});

export type NotificationPrefs = z.infer<typeof NotificationPrefsSchema>;
