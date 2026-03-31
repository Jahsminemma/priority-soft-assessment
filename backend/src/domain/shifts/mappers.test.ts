import { describe, it, expect } from "vitest";
import { shiftRecordToDto, type ShiftRecord } from "./index.js";

describe("shiftRecordToDto", () => {
  it("maps Prisma-shaped row to ShiftDto", () => {
    const row = {
      id: "d0000000-0000-4000-8000-000000000001",
      locationId: "a0000000-0000-4000-8000-000000000001",
      startAtUtc: new Date("2026-03-02T23:00:00.000Z"),
      endAtUtc: new Date("2026-03-03T03:00:00.000Z"),
      requiredSkillId: "b0000000-0000-4000-8000-000000000001",
      headcount: 2,
      isPremium: false,
      status: "DRAFT" as const,
      weekKey: "2026-W09",
      createdById: "c0000000-0000-4000-8000-000000000002",
    } as ShiftRecord;

    const dto = shiftRecordToDto(row);
    expect(dto.id).toBe(row.id);
    expect(dto.startAtUtc).toBe("2026-03-02T23:00:00.000Z");
    expect(dto.createdById).toBe(row.createdById);
  });
});
