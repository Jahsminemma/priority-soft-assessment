import { z } from "zod";

export const UserRoleSchema = z.enum(["ADMIN", "MANAGER", "STAFF"]);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const UserDtoSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  role: UserRoleSchema,
  managerLocationIds: z.array(z.string().uuid()),
});

export type UserDto = z.infer<typeof UserDtoSchema>;

export const LoginResponseSchema = z.object({
  token: z.string(),
  user: UserDtoSchema,
});

export type LoginResponse = z.infer<typeof LoginResponseSchema>;

export const CreateInviteRequestSchema = z
  .object({
    email: z.string().email(),
    name: z.string().min(1).max(120),
    role: UserRoleSchema,
    desiredHoursWeekly: z.number().min(0).max(80).nullable().optional(),
    managerLocationIds: z.array(z.string().uuid()).optional(),
    /** Required when role is STAFF: at least one skill from the catalog. */
    staffSkillIds: z.array(z.string().uuid()).optional(),
    /** Required when role is STAFF: at least one location where they are certified. */
    staffLocationIds: z.array(z.string().uuid()).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.role === "MANAGER" && (data.managerLocationIds?.length ?? 0) < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Pick at least one location for a manager.",
        path: ["managerLocationIds"],
      });
    }
    if (data.role === "STAFF" && (data.staffSkillIds?.length ?? 0) < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Pick at least one skill for staff.",
        path: ["staffSkillIds"],
      });
    }
    if (data.role === "STAFF" && (data.staffLocationIds?.length ?? 0) < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Pick at least one location for staff.",
        path: ["staffLocationIds"],
      });
    }
  });

export type CreateInviteRequest = z.infer<typeof CreateInviteRequestSchema>;

export const CreateInviteResponseSchema = z.object({
  token: z.string(),
  expiresAt: z.string(),
});

export type CreateInviteResponse = z.infer<typeof CreateInviteResponseSchema>;

export const RegisterVerifyResponseSchema = z.object({
  name: z.string(),
  email: z.string().email(),
  role: UserRoleSchema,
});

export type RegisterVerifyResponse = z.infer<typeof RegisterVerifyResponseSchema>;

export const RegisterCompleteRequestSchema = z.object({
  token: z.string().min(32),
  password: z.string().min(8).max(200),
});

export type RegisterCompleteRequest = z.infer<typeof RegisterCompleteRequestSchema>;

export const TeamLocationSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
});

export const TeamSkillSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
});

export const TeamManagerRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  locations: z.array(TeamLocationSummarySchema),
  /** Managers are not assigned shift skills in this model; always empty. */
  skills: z.array(TeamSkillSummarySchema),
});

export const TeamStaffRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  desiredHoursWeekly: z.number().nullable(),
  skills: z.array(TeamSkillSummarySchema),
  /** Certified work locations (StaffCertification). */
  locations: z.array(TeamLocationSummarySchema),
});

/** Admin replaces all certified locations for a staff member. */
export const StaffLocationsPatchRequestSchema = z.object({
  locationIds: z.array(z.string().uuid()).min(1),
});

export type StaffLocationsPatchRequest = z.infer<typeof StaffLocationsPatchRequestSchema>;

export const TeamListResponseSchema = z.object({
  managers: z.array(TeamManagerRowSchema),
  staff: z.array(TeamStaffRowSchema),
});

export type TeamListResponse = z.infer<typeof TeamListResponseSchema>;
