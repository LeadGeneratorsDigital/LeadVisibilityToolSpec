import { describe, expect, it } from "vitest";
import { currentMonthKey, formatMonthHeader, monthsEndingAt } from "./month";

describe("formatMonthHeader", () => {
  it.each([
    ["2026-10-01", "Oct 26"],
    ["2026-01-01", "Jan 26"],
    ["2009-12-01", "Dec 09"],
  ])("%s -> %s", (month, expected) => {
    expect(formatMonthHeader(month)).toBe(expected);
  });

  it.each(["2026-10-02", "2026-13-01", "2026-00-01", "Oct 26"])("rejects non-month key %s", (month) => {
    expect(() => formatMonthHeader(month)).toThrow(RangeError);
  });
});

describe("monthsEndingAt", () => {
  it("crosses a year boundary, oldest first", () => {
    expect(monthsEndingAt("2026-02-01", 4)).toEqual(["2025-11-01", "2025-12-01", "2026-01-01", "2026-02-01"]);
  });

  it("count 1 is just the latest month", () => {
    expect(monthsEndingAt("2026-10-01", 1)).toEqual(["2026-10-01"]);
  });
});

describe("currentMonthKey", () => {
  it("uses the London calendar, not UTC (23:30Z on 30 Sep is 00:30 BST on 1 Oct)", () => {
    expect(currentMonthKey(new Date("2026-09-30T23:30:00Z"))).toBe("2026-10-01");
    expect(currentMonthKey(new Date("2026-09-30T23:30:00Z"), "UTC")).toBe("2026-09-01");
  });
});
