import { describe, expect, it } from "vitest";
import {
  DEFAULT_HOURLY_RATE_USD,
  fifoStraightOtPerInterval,
  laborUsdFromSplit,
  resolveHourlyRateUsd,
} from "./overtimeCost.js";

describe("resolveHourlyRateUsd", () => {
  it("prefers staff override", () => {
    expect(resolveHourlyRateUsd(25, 18)).toBe(25);
  });
  it("falls back to location default", () => {
    expect(resolveHourlyRateUsd(null, 18)).toBe(18);
  });
  it("uses app default", () => {
    expect(resolveHourlyRateUsd(null, null)).toBe(DEFAULT_HOURLY_RATE_USD);
  });
});

describe("fifoStraightOtPerInterval", () => {
  it("attributes OT to later shifts after 40h", () => {
    const eight = 8 * 60;
    const intervals = Array.from({ length: 6 }, (_, i) => ({
      id: `s${i}`,
      startMs: i * 86400_000,
      durationMin: eight,
    }));
    const m = fifoStraightOtPerInterval(intervals);
    expect(m.get("s0")!.otMin).toBe(0);
    expect(m.get("s4")!.otMin).toBe(0);
    expect(m.get("s5")!.straightMin).toBe(0);
    expect(m.get("s5")!.otMin).toBe(eight);
  });

  it("stable tie-break by id", () => {
    const t = 1_000_000;
    const m = fifoStraightOtPerInterval([
      { id: "b", startMs: t, durationMin: 60 },
      { id: "a", startMs: t, durationMin: 60 },
    ]);
    expect(m.get("a")!.straightMin).toBe(60);
    expect(m.get("b")!.straightMin).toBe(60);
  });
});

describe("laborUsdFromSplit", () => {
  it("applies 1.5x to OT minutes", () => {
    const rate = 20;
    const usd = laborUsdFromSplit(60, 60, rate);
    expect(usd).toBe(20 + 30);
  });
});
