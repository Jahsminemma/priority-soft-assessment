import { describe, expect, it } from "vitest";
import {
  addDaysYmd,
  formatWeekRangeLabel,
  localDateStringToWeekKey,
  localDateToWeekKey,
  todayLocalYmd,
  weekKeyToLocalMondayYmd,
} from "./weekKey.js";

describe("localDateToWeekKey", () => {
  it("maps known Monday to 2026-W09 (seed week)", () => {
    expect(localDateToWeekKey(new Date(2026, 1, 23))).toBe("2026-W09");
  });

  it("maps any day in the week to the same key", () => {
    const w = "2026-W09";
    expect(localDateToWeekKey(new Date(2026, 1, 23))).toBe(w);
    expect(localDateToWeekKey(new Date(2026, 1, 28))).toBe(w);
    expect(localDateToWeekKey(new Date(2026, 2, 1))).toBe(w);
  });
});

describe("round-trip", () => {
  it("weekKey -> Monday YMD -> weekKey", () => {
    const wk = "2026-W09";
    const mon = weekKeyToLocalMondayYmd(wk);
    expect(mon).toBe("2026-02-23");
    expect(localDateStringToWeekKey(mon!)).toBe(wk);
  });

  it("today YMD round-trips", () => {
    const ymd = todayLocalYmd();
    const wk = localDateStringToWeekKey(ymd);
    expect(weekKeyToLocalMondayYmd(wk)).toBeTruthy();
    expect(localDateStringToWeekKey(weekKeyToLocalMondayYmd(wk)!)).toBe(wk);
  });
});

describe("addDaysYmd", () => {
  it("adds days across month boundary", () => {
    expect(addDaysYmd("2026-02-28", 1)).toBe("2026-03-01");
  });
});

describe("formatWeekRangeLabel", () => {
  it("includes start, end, and year", () => {
    const s = formatWeekRangeLabel("2026-W09", "en");
    expect(s).toMatch(/2026/);
    expect(s).toContain("–");
  });
});
