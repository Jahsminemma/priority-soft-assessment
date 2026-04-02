import { z } from "zod";

export const AuditExportQuerySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  /** When set, only logs tied to this location (shifts, assignments, week publish/unpublish for that site). */
  locationId: z.string().uuid().optional(),
});

export type AuditExportQuery = z.infer<typeof AuditExportQuerySchema>;

export const AuditListQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  locationId: z.string().uuid().optional(),
});

export type AuditListQuery = z.infer<typeof AuditListQuerySchema>;

export const AuditLogRowDtoSchema = z.object({
  id: z.string().uuid(),
  actorUserId: z.string().uuid(),
  actorName: z.string(),
  actorRole: z.enum(["ADMIN", "MANAGER", "STAFF", "SYSTEM"]),
  entityType: z.string(),
  entityId: z.string(),
  action: z.string(),
  beforeJson: z.unknown().nullable(),
  afterJson: z.unknown().nullable(),
  createdAt: z.string(),
  locationId: z.string().uuid().nullable(),
  locationName: z.string().nullable(),
});

export type AuditLogRowDto = z.infer<typeof AuditLogRowDtoSchema>;
