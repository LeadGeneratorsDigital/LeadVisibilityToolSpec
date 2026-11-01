import { describe, expect, it } from "vitest";
import { planPhrasePaste } from "./phrase-paste";

const none = { headings: [], phrases: [] };

describe("planPhrasePaste", () => {
  it("reads headings (ending in a colon or in capitals) and the phrases under them, in order", () => {
    const plan = planPhrasePaste("loose phrase\nWHAT BUYERS SEARCH FOR\nart restorer\nQuestions:\nhow to restore a painting\n", none);
    expect(plan.lines).toEqual([
      { kind: "phrase", text: "loose phrase", heading: null, skip: null },
      { kind: "heading", name: "WHAT BUYERS SEARCH FOR", existing: false },
      { kind: "phrase", text: "art restorer", heading: "WHAT BUYERS SEARCH FOR", skip: null },
      { kind: "heading", name: "Questions", existing: false },
      { kind: "phrase", text: "how to restore a painting", heading: "Questions", skip: null },
    ]);
    expect(plan.newHeadings).toEqual(["WHAT BUYERS SEARCH FOR", "Questions"]);
    expect(plan.phrasesToAdd).toBe(3);
  });

  it("keeps mixed-case lines with capital words as phrases", () => {
    const plan = planPhrasePaste("CCTV system for business premises\nUK solar installer", none);
    expect(plan.lines.map((l) => l.kind)).toEqual(["phrase", "phrase"]);
  });

  it("strips bullets, list numbers, blank lines and extra spaces", () => {
    const plan = planPhrasePaste("- first   phrase\n\n• second\n* third\n1. fourth\n2) fifth\r\n  ", none);
    expect(plan.lines.map((l) => (l.kind === "phrase" ? l.text : l.name))).toEqual(["first phrase", "second", "third", "fourth", "fifth"]);
  });

  it("reuses an existing heading in any case or spacing, under its saved name", () => {
    const plan = planPhrasePaste("buyer  group one:\nnew phrase", { headings: ["Buyer Group One"], phrases: [] });
    expect(plan.lines[0]).toEqual({ kind: "heading", name: "Buyer Group One", existing: true });
    expect(plan.lines[1]).toMatchObject({ heading: "Buyer Group One" });
    expect(plan.newHeadings).toEqual([]);
  });

  it("does not create the same new heading twice", () => {
    const plan = planPhrasePaste("Group:\na\ngroup:\nb", none);
    expect(plan.newHeadings).toEqual(["Group"]);
    expect(plan.lines.filter((l) => l.kind === "phrase").map((l) => l.kind === "phrase" && l.heading)).toEqual(["Group", "Group"]);
  });

  it("marks phrases the lead already tracks and repeats within the list, and does not count them", () => {
    const plan = planPhrasePaste("Art Restorer\nnew one\nnew  one\nanother", { headings: [], phrases: ["art restorer"] });
    expect(plan.lines.map((l) => l.kind === "phrase" && l.skip)).toEqual(["tracked", null, "repeated", null]);
    expect(plan.phrasesToAdd).toBe(2);
  });

  it("an empty paste plans nothing", () => {
    expect(planPhrasePaste(" \n\n", none)).toEqual({ lines: [], newHeadings: [], phrasesToAdd: 0 });
  });
});
