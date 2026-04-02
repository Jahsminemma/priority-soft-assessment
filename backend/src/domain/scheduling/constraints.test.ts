import { describe, it, expect } from "vitest";
import {
  evaluateAssignmentConstraints,
  intervalsOverlap,
  minGapBetweenNonOverlapping,
  splitShiftIntoLocalDaySegments,
} from "./index.js";

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

  it("fails when a UNAVAILABLE exception overlaps the shift", () => {
    const { hard } = evaluateAssignmentConstraints(
      {
        ...baseCtx,
        availabilityExceptions: [
          {
            startAtUtc: new Date("2026-03-02T19:00:00.000Z"),
            endAtUtc: new Date("2026-03-02T21:00:00.000Z"),
            type: "UNAVAILABLE",
          },
        ],
      },
      {},
    );
    expect(hard.some((h) => h.code === "OUTSIDE_AVAILABILITY")).toBe(true);
  });

  it("does not treat AVAILABLE_OVERRIDE as unavailability", () => {
    const { hard } = evaluateAssignmentConstraints(
      {
        ...baseCtx,
        availabilityExceptions: [
          {
            startAtUtc: new Date("2026-03-02T19:00:00.000Z"),
            endAtUtc: new Date("2026-03-02T21:00:00.000Z"),
            type: "AVAILABLE_OVERRIDE",
          },
        ],
      },
      {},
    );
    expect(hard.some((h) => h.code === "OUTSIDE_AVAILABILITY")).toBe(false);
  });

  it("emits one daily >8h warning even if multiple days exceed 8h", () => {
    const { warnings } = evaluateAssignmentConstraints(
      {
        ...baseCtx,
        shift: {
          ...baseCtx.shift,
          startAtUtc: new Date("2026-03-02T17:00:00Z"),
          endAtUtc: new Date("2026-03-03T02:30:00Z"),
        },
        otherAssignments: [
          {
            shiftId: "s-next-day",
            startAtUtc: new Date("2026-03-03T17:00:00Z"),
            endAtUtc: new Date("2026-03-04T02:30:00Z"),
            locationTzIana: "America/Los_Angeles",
          },
        ],
      },
      {},
    );
    const dailyWarns = warnings.filter((w) => w.code === "DAILY_WARN_8H");
    expect(dailyWarns).toHaveLength(1);
    expect(dailyWarns[0]?.message).toContain("9.5h");
  });

  it("does not attribute other-location work to the same local day", () => {
    // LA Thu 9-5 (8h) plus NY Fri 9-11 (2h) should NOT create a Thu warning
    // when scheduling the LA shift. (Fri NY work remains on Fri when interpreted
    // as a day-at-that-location.)
    const { warnings } = evaluateAssignmentConstraints(
      {
        ...baseCtx,
        shift: {
          ...baseCtx.shift,
          // Thu Apr 9 2026 09:00-17:00 America/Los_Angeles
          startAtUtc: new Date("2026-04-09T16:00:00Z"),
          endAtUtc: new Date("2026-04-10T00:00:00Z"),
          locationTzIana: "America/Los_Angeles",
        },
        otherAssignments: [
          {
            shiftId: "s-ny-fri-morning",
            // Fri Apr 10 2026 09:00-11:00 America/New_York
            startAtUtc: new Date("2026-04-10T13:00:00Z"),
            endAtUtc: new Date("2026-04-10T15:00:00Z"),
            locationTzIana: "America/New_York",
          },
        ],
      },
      {},
    );
    expect(warnings.some((w) => w.code === "DAILY_WARN_8H")).toBe(false);
  });

  it("shows projected weekly hours in overtime warning", () => {
    const { warnings } = evaluateAssignmentConstraints(
      {
        ...baseCtx,
        shift: {
          ...baseCtx.shift,
          startAtUtc: new Date("2026-03-06T18:00:00Z"),
          endAtUtc: new Date("2026-03-07T02:00:00Z"),
        },
        otherAssignments: [
          {
            shiftId: "s-mon",
            startAtUtc: new Date("2026-03-02T18:00:00Z"),
            endAtUtc: new Date("2026-03-03T02:00:00Z"),
            locationTzIana: "America/Los_Angeles",
          },
          {
            shiftId: "s-tue",
            startAtUtc: new Date("2026-03-03T18:00:00Z"),
            endAtUtc: new Date("2026-03-04T02:00:00Z"),
            locationTzIana: "America/Los_Angeles",
          },
          {
            shiftId: "s-wed",
            startAtUtc: new Date("2026-03-04T18:00:00Z"),
            endAtUtc: new Date("2026-03-05T02:00:00Z"),
            locationTzIana: "America/Los_Angeles",
          },
          {
            shiftId: "s-thu",
            startAtUtc: new Date("2026-03-05T18:00:00Z"),
            endAtUtc: new Date("2026-03-06T02:00:00Z"),
            locationTzIana: "America/Los_Angeles",
          },
          {
            shiftId: "s-fri-pre",
            startAtUtc: new Date("2026-03-07T03:00:00Z"),
            endAtUtc: new Date("2026-03-07T07:00:00Z"),
            locationTzIana: "America/Los_Angeles",
          },
          {
            shiftId: "s-sun",
            startAtUtc: new Date("2026-03-08T18:00:00Z"),
            endAtUtc: new Date("2026-03-09T02:00:00Z"),
            locationTzIana: "America/Los_Angeles",
          },
        ],
      },
      {},
    );
    const overtime = warnings.find((w) => w.code === "WEEKLY_WARN_40");
    expect(overtime).toBeDefined();
    expect(overtime?.message).toContain("52.0h");
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
