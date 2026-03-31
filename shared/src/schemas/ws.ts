import { z } from "zod";

export const WsEventNameSchema = z.enum([
  "schedule.weekUpdated",
  "shift.updated",
  "assignment.changed",
  "coverage.requestCreated",
  "coverage.requestUpdated",
  "notification.created",
  "presence.onDutyUpdated",
  "conflict.assignmentRejected",
]);

export type WsEventName = z.infer<typeof WsEventNameSchema>;

export const WsEnvelopeSchema = z.object({
  event: WsEventNameSchema,
  payload: z.unknown(),
});

export type WsEnvelope = z.infer<typeof WsEnvelopeSchema>;
