import { describe, expect, it } from "vitest";
import { NOT_RANKED_POSITION, visibilityFor } from "./visibility";

describe("visibilityFor (Stage 1 bands agreed with the client)", () => {
  it.each([
    [1, "visible"],
    [20, "visible"],
    [21, "partly"],
    [50, "partly"],
    [51, "partly"],
    [100, "partly"],
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
