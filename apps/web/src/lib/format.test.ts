import { describe, expect, it } from "vitest";
import { checkedSuffix, formatDate, formatLongDate } from "./format";

describe("formatLongDate", () => {
  it("uses the British day-month order with full names and no commas", () => {
    expect(formatLongDate(new Date(2026, 9, 8, 12))).toBe("Thursday 8 October 2026");
  });
});

describe("formatDate", () => {
  it("formats date-only values without timezone shift, and empty as blank", () => {
    expect(formatDate("2026-10-08")).toBe("8 Oct 2026");
    expect(formatDate(null)).toBe("");
  });
});

describe("checkedSuffix", () => {
  it("names the day Google was checked, and is blank when it was never recorded", () => {
    expect(checkedSuffix("2026-10-05T09:00:00+00:00")).toBe(" - checked 5 Oct 2026");
    expect(checkedSuffix(null)).toBe("");
    expect(checkedSuffix(undefined)).toBe("");
  });
});
