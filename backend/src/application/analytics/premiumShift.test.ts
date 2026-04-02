import { describe, expect, it } from "vitest";
import { countsAsPremiumDesirableShift } from "./analytics.service.js";

function atUtc(iso: string): Date {
  return new Date(iso);
}

describe("countsAsPremiumDesirableShift", () => {
  const ny = { tzIana: "America/New_York" };

  it("returns true when isPremium regardless of time", () => {
    expect(
      countsAsPremiumDesirableShift({
        isPremium: true,
        startAtUtc: atUtc("2026-04-01T14:00:00.000Z"),
        location: ny,
      }),
    ).toBe(true);
  });

  it("tags Friday 17:00 local as premium", () => {
    expect(
      countsAsPremiumDesirableShift({
        isPremium: false,
        startAtUtc: atUtc("2026-04-03T21:00:00.000Z"),
        location: ny,
      }),
    ).toBe(true);
  });

  it("does not tag Monday evening", () => {
    expect(
      countsAsPremiumDesirableShift({
        isPremium: false,
        startAtUtc: atUtc("2026-04-06T21:00:00.000Z"),
        location: ny,
      }),
    ).toBe(false);
  });
});
