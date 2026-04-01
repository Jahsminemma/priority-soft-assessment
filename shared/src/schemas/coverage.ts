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
