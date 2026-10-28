import { describe, expect, it } from "vitest";
import { buildRankingCsv, buildRankingGrid, csvPositionText, historyMonths } from "./ranking-grid";

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

  it("carries each month's check time beside its position, null when it was never recorded", () => {
    const rows = buildRankingGrid([], [phrases[3]!], [
      { phrase_id: "p0", month: "2026-10-01", position: 4, checked_at: "2026-10-05T09:00:00+00:00" },
      { phrase_id: "p0", month: "2026-09-01", position: 7 },
      { phrase_id: "p3", month: "2026-10-01", position: 1, checked_at: "2026-10-06T09:00:00+00:00" },
    ]);
    const row = rows[0]!;
    if (row.kind !== "phrase") throw new Error("expected phrase row");
    expect(row.checkedAt).toEqual({ "2026-10-01": "2026-10-05T09:00:00+00:00", "2026-09-01": null });
    expect(row.positions).toEqual({ "2026-10-01": 4, "2026-09-01": 7 });
  });
});

describe("historyMonths", () => {
  it("has one column per month a ranking was taken, oldest first, with no column for months between", () => {
    expect(historyMonths([
      { phrase_id: "a", month: "2026-10-01", position: 3 },
      { phrase_id: "b", month: "2026-10-01", position: null },
      { phrase_id: "a", month: "2026-04-01", position: 9 },
      { phrase_id: "b", month: "2026-07-01", position: 101 },
    ])).toEqual(["2026-04-01", "2026-07-01", "2026-10-01"]);
  });

  it("is empty with no rankings", () => {
    expect(historyMonths([])).toEqual([]);
  });
});

describe("buildRankingCsv", () => {
  const rankings = [
    { phrase_id: "p0", month: "2026-08-01", position: 4 },
    { phrase_id: "p1", month: "2026-08-01", position: 101 },
    { phrase_id: "p1", month: "2026-10-01", position: null },
    { phrase_id: "p3", month: "2026-10-01", position: 12 },
  ];
  const months = historyMonths(rankings);

  it("has a header with each checked month, oldest first, and one row per phrase under its heading", () => {
    expect(buildRankingCsv(buildRankingGrid(groups, phrases, rankings), months).split("\n")).toEqual([
      "Heading,Key phrase,Aug 2026,Oct 2026",
      ",cleaning company,4,",
      "Contracts London,contract cleaning,Not Ranked,",
      "Contracts London,factory cleaning,,",
      "Warehouse Cleaning,warehouse cleaning,,12",
    ]);
  });

  it("files phrases after an imported is_heading row under that heading", () => {
    const grid = buildRankingGrid([], [
      { id: "h", buyer_group_id: null, phrase_text: "Imported heading", is_heading: true, sort_order: 1 },
      { id: "p", buyer_group_id: null, phrase_text: "office cleaning", is_heading: false, sort_order: 2 },
    ], []);
    expect(buildRankingCsv(grid, ["2026-10-01"]).split("\n")[1]).toBe("Imported heading,office cleaning,");
  });

  it("quotes text holding a comma, quote or line break, doubling inner quotes", () => {
    const grid = buildRankingGrid([{ id: "g", name: "Leeds, York", sort_order: 1 }], [
      { id: "a", buyer_group_id: "g", phrase_text: 'the "best" cleaners', is_heading: false, sort_order: 1 },
      { id: "b", buyer_group_id: "g", phrase_text: "line\nbreak", is_heading: false, sort_order: 2 },
    ], []);
    expect(buildRankingCsv(grid, []).split("\n").slice(1, 3)).toEqual(['"Leeds, York","the ""best"" cleaners"', '"Leeds, York","line']);
  });

  it("is just the header with no phrases", () => {
    expect(buildRankingCsv([], ["2026-10-01"])).toBe("Heading,Key phrase,Oct 2026");
  });
});

describe("csvPositionText", () => {
  it.each([
    [1, "1"],
    [100, "100"],
    [101, "Not Ranked"],
    [null, ""],
    [undefined, ""],
  ])("%s -> %j", (position, expected) => {
    expect(csvPositionText(position)).toBe(expected);
  });
});
