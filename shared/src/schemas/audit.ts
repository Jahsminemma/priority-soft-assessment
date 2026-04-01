import { z } from "zod";

export const AuditExportQuerySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
});

export type AuditExportQuery = z.infer<typeof AuditExportQuerySchema>;
