import { describe, expect, it } from "vitest";
import { NOT_RANKED_POSITION, visibilityFor } from "./visibility";

describe("visibilityFor (spec section 6 thresholds)", () => {
  it.each([
    [1, "visible"],
    [20, "visible"],
    [21, "partly"],
    [50, "partly"],
    [51, "invisible"],
    [100, "invisible"],
    [NOT_RANKED_POSITION, "invisible"],
  ] as const)("position %i -> %s", (position, expected) => {
    expect(visibilityFor(position)).toBe(expected);
  });

  it("NULL is blank, not Invisible", () => {
    expect(visibilityFor(null)).toBeNull();
  });

  it.each([0, -3, 12.5, Number.NaN])("rejects impossible position %s", (position) => {
    expect(() => visibilityFor(position)).toThrow(RangeError);
  });
});
