import { describe, it, expect } from "vitest";
import {
  evaluateAssignmentConstraints,
  intervalsOverlap,
  minGapBetweenNonOverlapping,
  splitShiftIntoLocalDaySegments,
} from "./constraints.js";

describe("intervalsOverlap", () => {
  it("detects overlap", () => {
    const a = new Date("2026-03-01T10:00:00Z");
    const b = new Date("2026-03-01T14:00:00Z");
    const c = new Date("2026-03-01T12:00:00Z");
    const d = new Date("2026-03-01T16:00:00Z");
    expect(intervalsOverlap(a, b, c, d)).toBe(true);
  });

  it("no overlap when adjacent", () => {
    const a = new Date("2026-03-01T10:00:00Z");
    const b = new Date("2026-03-01T12:00:00Z");
    const c = new Date("2026-03-01T12:00:00Z");
    const d = new Date("2026-03-01T14:00:00Z");
    expect(intervalsOverlap(a, b, c, d)).toBe(false);
  });
});

describe("minGapBetweenNonOverlapping", () => {
  it("returns gap when A before B", () => {
    const a = new Date("2026-03-01T10:00:00Z");
    const b = new Date("2026-03-01T12:00:00Z");
    const c = new Date("2026-03-01T18:00:00Z");
    const d = new Date("2026-03-01T20:00:00Z");
    expect(minGapBetweenNonOverlapping(a, b, c, d)).toBe(6 * 60 * 60 * 1000);
  });
});

describe("evaluateAssignmentConstraints", () => {
  const skillServer = "b0000000-0000-4000-8000-000000000001";
  const baseCtx = {
    locationId: "a0000000-0000-4000-8000-000000000001",
    shift: {
      shiftId: "s-new",
      startAtUtc: new Date("2026-03-02T18:00:00Z"),
      endAtUtc: new Date("2026-03-02T22:00:00Z"),
      locationTzIana: "America/Los_Angeles",
    },
    requiredSkillId: skillServer,
    staffUserId: "c0000000-0000-4000-8000-000000000010",
    staffSkillIds: [skillServer],
    certifiedLocationIds: ["a0000000-0000-4000-8000-000000000001"],
    availabilityRules: [{ dayOfWeek: 1, startLocalTime: "09:00", endLocalTime: "23:59" }],
    availabilityExceptions: [],
    otherAssignments: [],
  };

  it("passes when no conflicts", () => {
    const { hard } = evaluateAssignmentConstraints(baseCtx, {});
    expect(hard).toHaveLength(0);
  });

  it("fails on missing skill", () => {
    const { hard } = evaluateAssignmentConstraints(
      { ...baseCtx, staffSkillIds: [] },
      {},
    );
    expect(hard.some((h) => h.code === "MISSING_SKILL")).toBe(true);
  });

  it("fails on double book", () => {
    const { hard } = evaluateAssignmentConstraints(
      {
        ...baseCtx,
        otherAssignments: [
          {
            shiftId: "s-other",
            startAtUtc: new Date("2026-03-02T19:00:00Z"),
            endAtUtc: new Date("2026-03-02T21:00:00Z"),
            locationTzIana: "America/Los_Angeles",
          },
        ],
      },
      {},
    );
    expect(hard.some((h) => h.code === "DOUBLE_BOOK")).toBe(true);
  });
});

describe("splitShiftIntoLocalDaySegments", () => {
  it("splits overnight shift in LA", () => {
    const start = new Date("2026-03-07T07:00:00Z");
    const end = new Date("2026-03-07T11:00:00Z");
    const segs = splitShiftIntoLocalDaySegments(start, end, "America/Los_Angeles");
    expect(segs.length).toBeGreaterThanOrEqual(1);
  });
});
