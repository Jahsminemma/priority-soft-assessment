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
  })
  .superRefine((data, ctx) => {
    if (data.role === "MANAGER" && (data.managerLocationIds?.length ?? 0) < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Pick at least one location for a manager.",
        path: ["managerLocationIds"],
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
