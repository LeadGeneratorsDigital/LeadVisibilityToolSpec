import { describe, expect, it } from "vitest";
import { formatDate, formatLongDate } from "./format";

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
