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
