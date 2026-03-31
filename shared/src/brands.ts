import { z } from "zod";

export const UserIdSchema = z.string().uuid().brand<"UserId">();
export type UserId = z.infer<typeof UserIdSchema>;

export const LocationIdSchema = z.string().uuid().brand<"LocationId">();
export type LocationId = z.infer<typeof LocationIdSchema>;

export const ShiftIdSchema = z.string().uuid().brand<"ShiftId">();
export type ShiftId = z.infer<typeof ShiftIdSchema>;

export const SkillIdSchema = z.string().uuid().brand<"SkillId">();
export type SkillId = z.infer<typeof SkillIdSchema>;
