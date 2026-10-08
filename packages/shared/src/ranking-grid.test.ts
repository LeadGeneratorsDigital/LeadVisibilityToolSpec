import { describe, expect, it } from "vitest";
import { buildChatGptCopy, buildRankingGrid, historyMonths, positionText } from "./ranking-grid";

const groups = [
  { id: "g2", name: "Warehouse Cleaning", sort_order: 2 },
  { id: "g1", name: "Contracts London", sort_order: 1 },
];
const phrases = [
  { id: "p3", buyer_group_id: "g2", phrase_text: "warehouse cleaning", is_heading: false, sort_order: 1 },
  { id: "p2", buyer_group_id: "g1", phrase_text: "factory cleaning", is_heading: false, sort_order: 2 },
  { id: "p1", buyer_group_id: "g1", phrase_text: "contract cleaning", is_heading: false, sort_order: 1 },
  { id: "p0", buyer_group_id: null, phrase_text: "cleaning company", is_heading: false, sort_order: 1 },
];

describe("buildRankingGrid", () => {
  it("orders ungrouped phrases, then each group heading followed by its phrases by sort_order", () => {
    const rows = buildRankingGrid(groups, phrases, []);
    expect(rows.map((r) => `${r.kind}:${r.label}`)).toEqual([
      "phrase:cleaning company",
      "heading:Contracts London",
      "phrase:contract cleaning",
      "phrase:factory cleaning",
      "heading:Warehouse Cleaning",
      "phrase:warehouse cleaning",
    ]);
  });

  it("renders an is_heading phrase as a heading row in place", () => {
    const rows = buildRankingGrid([], [{ id: "h", buyer_group_id: null, phrase_text: "Imported heading", is_heading: true, sort_order: 0 }], []);
    expect(rows).toEqual([{ kind: "heading", key: "h", label: "Imported heading" }]);
  });

  it("keeps stored NULL distinct from a month with no row", () => {
    const rows = buildRankingGrid([], [phrases[3]!], [{ phrase_id: "p0", month: "2026-09-01", position: null }]);
    const row = rows[0]!;
    if (row.kind !== "phrase") throw new Error("expected phrase row");
    expect(row.positions["2026-09-01"]).toBeNull();
    expect(row.positions["2026-08-01"]).toBeUndefined();
  });
});

describe("historyMonths", () => {
  it("fills gaps between the first and last month", () => {
    expect(historyMonths([
      { phrase_id: "a", month: "2026-10-01", position: 3 },
      { phrase_id: "a", month: "2026-07-01", position: 9 },
    ])).toEqual(["2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01"]);
  });

  it("is empty with no rankings", () => {
    expect(historyMonths([])).toEqual([]);
  });
});

describe("positionText", () => {
  it.each([
    [7, "Visible (#7)"],
    [35, "Partly visible (#35)"],
    [80, "Invisible (#80)"],
    [101, "Invisible (not in top 100)"],
    [null, ""],
    [undefined, ""],
  ])("%s -> %j", (position, expected) => {
    expect(positionText(position)).toBe(expected);
  });
});

describe("buildChatGptCopy", () => {
  const rankings = [
    { phrase_id: "p0", month: "2026-10-01", position: 4 },
    { phrase_id: "p0", month: "2026-03-01", position: 60 },
    { phrase_id: "p0", month: "2026-04-01", position: 30 },
  ];
  const rows = buildRankingGrid([], [phrases[3]!], rankings);

  it("puts the lead name on line 1 and the brief before the table", () => {
    const lines = buildChatGptCopy({ leadName: "BrightClean", brief: "Family firm.", rows, rankings }).split("\n");
    expect(lines[0]).toBe("BrightClean");
    expect(lines.indexOf("Family firm.")).toBeGreaterThan(0);
    expect(lines.indexOf("Family firm.")).toBeLessThan(lines.findIndex((l) => l.startsWith("Phrase\t")));
  });

  it("shows exactly the last six months ending at the latest data month, tab-separated", () => {
    const text = buildChatGptCopy({ leadName: "L", brief: "b", rows, rankings });
    expect(text).toContain("Phrase\tMay 26\tJun 26\tJul 26\tAug 26\tSep 26\tOct 26");
    expect(text).toContain("cleaning company\t\t\t\t\t\tVisible (#4)");
    expect(text).not.toContain("Apr 26");
  });

  it("includes group headings as their own line", () => {
    const grid = buildRankingGrid([groups[1]!], [phrases[2]!], []);
    expect(buildChatGptCopy({ leadName: "L", brief: "", rows: grid, rankings: [] }).split("\n")).toContain("Contracts London");
  });
});
