import { z } from "zod";

/** SWAP: `shiftId` = requester's shift. Optional `secondShiftId` = target's shift for a true two-way swap (A↔B). If omitted, handoff only (A gives shift to B). */
export const CreateCoverageRequestSchema = z.union([
  z
    .object({
      type: z.literal("SWAP"),
      shiftId: z.string().uuid(),
      targetId: z.string().uuid(),
      secondShiftId: z.string().uuid().optional(),
    })
    .refine((d) => d.secondShiftId === undefined || d.secondShiftId !== d.shiftId, {
      message: "secondShiftId must differ from shiftId",
      path: ["secondShiftId"],
    }),
  z.object({
    type: z.literal("DROP"),
    shiftId: z.string().uuid(),
  }),
]);

export type CreateCoverageRequest = z.infer<typeof CreateCoverageRequestSchema>;

const CoverageShiftSummarySchema = z.object({
  shiftId: z.string().uuid(),
  locationId: z.string().uuid(),
  locationName: z.string(),
  skillName: z.string(),
  localDateLabel: z.string(),
  localTimeLabel: z.string(),
});

export const ManagerCoverageQueueItemSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(["SWAP", "DROP"]),
  status: z.enum(["PENDING", "ACCEPTED"]),
  requesterId: z.string().uuid(),
  requesterName: z.string(),
  targetId: z.string().uuid().nullable(),
  targetName: z.string().nullable(),
  twoWay: z.boolean(),
  primaryShift: CoverageShiftSummarySchema,
  secondShift: CoverageShiftSummarySchema.nullable(),
  canApprove: z.boolean(),
  /** Present for DROP while still open for pickup. */
  expiresAt: z.string().nullable(),
  /** DROP only: how the callout behaves. */
  calloutMode: z.enum(["OPEN", "DIRECTED"]).nullable(),
  /** DROP PENDING: staff who can take this shift (for manager assign). */
  eligibleCandidates: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
});

export const OpenCalloutItemSchema = z.object({
  requestId: z.string().uuid(),
  requesterId: z.string().uuid(),
  requesterName: z.string(),
  shift: CoverageShiftSummarySchema,
});

export const OpenCalloutListSchema = z.array(OpenCalloutItemSchema);
export type OpenCalloutItem = z.infer<typeof OpenCalloutItemSchema>;

export const ManagerCoverageQueueSchema = z.array(ManagerCoverageQueueItemSchema);
export type ManagerCoverageQueueItem = z.infer<typeof ManagerCoverageQueueItemSchema>;
