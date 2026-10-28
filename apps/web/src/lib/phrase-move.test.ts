import { describe, expect, it } from "vitest";
import { planPhraseMove } from "./phrase-move";

const phrases = [
  { id: "a", buyer_group_id: "g1", sort_order: 1 },
  { id: "b", buyer_group_id: "g1", sort_order: 2 },
  { id: "c", buyer_group_id: "g2", sort_order: 1 },
  { id: "d", buyer_group_id: "g2", sort_order: 7 },
  { id: "e", buyer_group_id: null, sort_order: 3 },
];

describe("planPhraseMove", () => {
  it("puts the phrase after the last phrase of the target heading", () => {
    expect(planPhraseMove(phrases, "a", "g2")).toEqual({ buyerGroupId: "g2", sortOrder: 8 });
  });

  it("moves a phrase out of its heading to the end of the ungrouped phrases", () => {
    expect(planPhraseMove(phrases, "b", null)).toEqual({ buyerGroupId: null, sortOrder: 4 });
  });

  it("moves an ungrouped phrase under a heading", () => {
    expect(planPhraseMove(phrases, "e", "g1")).toEqual({ buyerGroupId: "g1", sortOrder: 3 });
  });

  it("starts an empty heading at 1", () => {
    expect(planPhraseMove(phrases, "c", "g3")).toEqual({ buyerGroupId: "g3", sortOrder: 1 });
  });

  it.each([
    ["a", "g1"],
    ["e", null],
  ])("writes nothing when %s is already under %s", (id, target) => {
    expect(planPhraseMove(phrases, id, target)).toBeNull();
  });

  it("writes nothing for an unknown phrase", () => {
    expect(planPhraseMove(phrases, "zz", "g1")).toBeNull();
  });
});
