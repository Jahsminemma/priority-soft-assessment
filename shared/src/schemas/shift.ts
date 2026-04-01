import { z } from "zod";
import { normalizeIsoWeekKey } from "../weekKey.js";

export const ShiftStatusSchema = z.enum(["DRAFT", "PUBLISHED"]);
export type ShiftStatus = z.infer<typeof ShiftStatusSchema>;

export const LocationSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  tzIana: z.string(),
});

export type LocationSummary = z.infer<typeof LocationSummarySchema>;

export const ShiftDtoSchema = z.object({
  id: z.string().uuid(),
  locationId: z.string().uuid(),
  startAtUtc: z.string(),
  endAtUtc: z.string(),
  requiredSkillId: z.string().uuid(),
  headcount: z.number().int().positive(),
  isPremium: z.boolean(),
  status: ShiftStatusSchema,
  weekKey: z.string(),
  createdById: z.string().uuid().nullable(),
  /** Present on manager/admin list responses: current assignment count. */
  assignedCount: z.number().int().min(0).optional(),
});

export type ShiftDto = z.infer<typeof ShiftDtoSchema>;

export const CreateShiftRequestSchema = z.object({
  locationId: z.string().uuid(),
  startAtUtc: z.string().datetime(),
  endAtUtc: z.string().datetime(),
  requiredSkillId: z.string().uuid(),
  headcount: z.number().int().positive(),
  weekKey: z.string().min(1).transform(normalizeIsoWeekKey),
  isPremium: z.boolean().optional(),
});

export type CreateShiftRequest = z.infer<typeof CreateShiftRequestSchema>;

export const ListShiftsQuerySchema = z.object({
  locationId: z.string().uuid(),
  weekKey: z.string().min(1).transform(normalizeIsoWeekKey),
});

export type ListShiftsQuery = z.infer<typeof ListShiftsQuerySchema>;

/** Staff: published shifts only, scoped to certified locations. */
export const ListShiftsStaffQuerySchema = z.object({
  weekKey: z.string().min(1).transform(normalizeIsoWeekKey),
});

export type ListShiftsStaffQuery = z.infer<typeof ListShiftsStaffQuerySchema>;

export const UpdateShiftRequestSchema = z
  .object({
    startAtUtc: z.string().datetime().optional(),
    endAtUtc: z.string().datetime().optional(),
    headcount: z.number().int().positive().optional(),
  })
  .refine((b) => b.startAtUtc !== undefined || b.endAtUtc !== undefined || b.headcount !== undefined, {
    message: "at_least_one_field",
  });

export type UpdateShiftRequest = z.infer<typeof UpdateShiftRequestSchema>;
