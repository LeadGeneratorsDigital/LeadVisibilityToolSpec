import { describe, expect, it } from "vitest";
import { bulkTargets, phraseTotal, runBulkUpdate } from "./bulk-update";

describe("runBulkUpdate", () => {
  it("starts every lead in order, one at a time, and a failure does not stop the rest", async () => {
    const calls: string[] = [];
    let inFlight = 0;
    let peak = 0;
    const result = await runBulkUpdate(["a", "b", "c"], async (id) => {
      calls.push(id);
      peak = Math.max(peak, ++inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      if (id === "b") throw new Error("A ranking pull is already running for this lead");
    });
    expect(calls).toEqual(["a", "b", "c"]);
    expect(peak).toBe(1);
    expect(result).toEqual({ started: ["a", "c"], failed: [{ id: "b", reason: "A ranking pull is already running for this lead" }] });
  });

  it("does nothing for an empty selection", async () => {
    expect(await runBulkUpdate([], async () => {})).toEqual({ started: [], failed: [] });
  });
});

describe("phraseTotal", () => {
  it("adds the phrase counts of the chosen leads, treating unknown leads as 0", () => {
    expect(phraseTotal(["a", "c", "x"], new Map([["a", 5], ["b", 9], ["c", 2]]))).toBe(7);
  });
});

describe("bulkTargets", () => {
  const lead = (id: string, website_domain: string | null = `${id}.co.uk`, location_code: string | null = "UK") => ({ id, business_name: `Lead ${id}`, website_domain, location_code });

  it("takes only ticked leads that are on screen, in screen order", () => {
    expect(bulkTargets([lead("b"), lead("a"), lead("c")], new Set(["a", "b", "hidden"]))).toEqual({ ready: ["b", "a"], skipped: [] });
  });

  it("names ticked leads with no website or no location instead of updating them", () => {
    expect(bulkTargets([lead("a"), lead("b", null), lead("c", "c.co.uk", null)], new Set(["a", "b", "c"]))).toEqual({ ready: ["a"], skipped: ["Lead b", "Lead c"] });
  });
});
