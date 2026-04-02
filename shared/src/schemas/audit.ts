import { z } from "zod";

export const AuditExportQuerySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  /** When set, only logs tied to this location (shifts, assignments, week publish/unpublish for that site). */
  locationId: z.string().uuid().optional(),
});

export type AuditExportQuery = z.infer<typeof AuditExportQuerySchema>;

export const AuditLogRowDtoSchema = z.object({
  id: z.string().uuid(),
  actorUserId: z.string().uuid(),
  actorName: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  action: z.string(),
  beforeJson: z.unknown().nullable(),
  afterJson: z.unknown().nullable(),
  createdAt: z.string(),
});

export type AuditLogRowDto = z.infer<typeof AuditLogRowDtoSchema>;
