import { buildRankingGrid } from "@lvt/shared";
import { describe, expect, it } from "vitest";
import { countVisibility, dashboardStats, initials, latestVisibilityByLead, monthUpdateState, visibilitySinceMonth, rankingSummary, relativeTime, talkingPoints, trendBetween } from "./insights";

describe("relativeTime", () => {
  const now = new Date("2026-10-08T12:00:00Z");
  it.each([
    [null, "Never"],
    ["2026-10-08T11:59:40Z", "Just now"],
    ["2026-10-08T11:15:00Z", "45 min ago"],
    ["2026-10-08T07:00:00Z", "5 h ago"],
    ["2026-10-07T10:00:00Z", "Yesterday"],
    ["2026-10-02T12:00:00Z", "6 days ago"],
    ["2026-08-01T12:00:00Z", "1 Aug 2026"],
  ])("%s -> %s", (iso, expected) => {
    expect(relativeTime(iso, now)).toBe(expected);
  });
});

describe("countVisibility", () => {
  it("buckets by the Stage 1 bands and counts NULL/missing as no data", () => {
    expect(countVisibility([1, 20, 21, 100, 101, 101, null, undefined])).toEqual({ visible: 2, partly: 2, invisible: 2, noData: 2 });
  });
});

describe("monthUpdateState", () => {
  const phrase = (id: string) => ({ id, buyer_group_id: null, phrase_text: id, is_heading: false, sort_order: 1 });
  const rows = (rankings: Array<{ phrase_id: string; month: string; position: number | null }>) => buildRankingGrid([], [phrase("a"), phrase("b"), phrase("c")], rankings);

  it("is not updated when the month has no rows, and every phrase is blank", () => {
    expect(monthUpdateState(rows([{ phrase_id: "a", month: "2026-09-01", position: 3 }]), "2026-10-01")).toEqual({ updated: false, blanks: 3 });
  });

  it("counts a failed check and a phrase with no row as blanks, not a ranked or Not Ranked one", () => {
    const grid = rows([
      { phrase_id: "a", month: "2026-10-01", position: 101 },
      { phrase_id: "b", month: "2026-10-01", position: null },
    ]);
    expect(monthUpdateState(grid, "2026-10-01")).toEqual({ updated: true, blanks: 2 });
  });

  it("is updated with no blanks when every phrase has a position", () => {
    const grid = rows(["a", "b", "c"].map((id) => ({ phrase_id: id, month: "2026-10-01", position: 5 })));
    expect(monthUpdateState(grid, "2026-10-01")).toEqual({ updated: true, blanks: 0 });
  });

  it("is updated when the only row for the month is a failed check", () => {
    expect(monthUpdateState(rows([{ phrase_id: "c", month: "2026-10-01", position: null }]), "2026-10-01")).toEqual({ updated: true, blanks: 3 });
  });
});

describe("visibilitySinceMonth", () => {
  it("reaches back far enough for a lead updated every three months", () => {
    expect(visibilitySinceMonth(new Date("2026-12-15T12:00:00Z"))).toBe("2026-07-01");
  });

  it("uses the London calendar month: 23:30 UTC on 30 September is already October in London", () => {
    expect(visibilitySinceMonth(new Date("2026-09-30T23:30:00Z"))).toBe("2026-05-01");
  });
});

describe("latestVisibilityByLead", () => {
  it("uses each lead's own latest month, not a global one", () => {
    const result = latestVisibilityByLead([
      { lead_id: "A", month: "2026-09-01", position: 80 },
      { lead_id: "A", month: "2026-10-01", position: 3 },
      { lead_id: "A", month: "2026-10-01", position: null },
      { lead_id: "B", month: "2026-09-01", position: 30 },
    ]);
    expect(result.get("A")).toEqual({ month: "2026-10-01", counts: { visible: 1, partly: 0, invisible: 0, noData: 1 } });
    expect(result.get("B")).toEqual({ month: "2026-09-01", counts: { visible: 0, partly: 1, invisible: 0, noData: 0 } });
  });
});

describe("trendBetween", () => {
  it.each([
    [12, 5, { direction: "up", places: 7 }],
    [5, 12, { direction: "down", places: 7 }],
    [9, 9, { direction: "same", places: 0 }],
    [null, 5, null],
    [5, undefined, null],
  ] as const)("%s -> %s", (previous, latest, expected) => {
    expect(trendBetween(previous, latest)).toEqual(expected);
  });
});

describe("rankingSummary", () => {
  it("counts the latest month and compares against the previous one, ignoring headings", () => {
    const rows = buildRankingGrid(
      [{ id: "g", name: "Group", sort_order: 1 }],
      [
        { id: "a", buyer_group_id: "g", phrase_text: "a", is_heading: false, sort_order: 1 },
        { id: "b", buyer_group_id: "g", phrase_text: "b", is_heading: false, sort_order: 2 },
        { id: "c", buyer_group_id: "g", phrase_text: "c", is_heading: false, sort_order: 3 },
      ],
      [
        { phrase_id: "a", month: "2026-09-01", position: 30 },
        { phrase_id: "a", month: "2026-10-01", position: 10 },
        { phrase_id: "b", month: "2026-09-01", position: 40 },
        { phrase_id: "b", month: "2026-10-01", position: 101 },
        { phrase_id: "c", month: "2026-10-01", position: null },
      ],
    );
    expect(rankingSummary(rows, ["2026-09-01", "2026-10-01"])).toEqual({
      latest: "2026-10-01",
      total: 3,
      counts: { visible: 1, partly: 0, invisible: 1, noData: 1 },
      improved: 1,
      dropped: 1,
    });
  });
});

describe("talkingPoints", () => {
  const MONTHS = ["2026-09-01", "2026-10-01"];
  /** One phrase per entry: [September, October]. Undefined means no ranking row that month. */
  const grid = (entries: Record<string, [number | null | undefined, number | null | undefined]>) =>
    buildRankingGrid(
      [{ id: "g", name: "Group", sort_order: 1 }],
      Object.keys(entries).map((text, i) => ({ id: text, buyer_group_id: "g", phrase_text: text, is_heading: false, sort_order: i })),
      Object.entries(entries).flatMap(([text, [sep, oct]]) => [
        ...(sep === undefined ? [] : [{ phrase_id: text, month: "2026-09-01", position: sep }]),
        ...(oct === undefined ? [] : [{ phrase_id: text, month: "2026-10-01", position: oct }]),
      ]),
    );
  const kinds = (entries: Parameters<typeof grid>[0]) => talkingPoints(grid(entries), MONTHS, 10).map((p) => `${p.kind}:${p.phrase}`);

  it("pins the move threshold: 3 places counts, 2 places within a band does not", () => {
    expect(kinds({ down3: [5, 8], down2: [5, 7], up3: [60, 57], up2: [60, 58] })).toEqual(["slipped:down3", "climbed:up3"]);
  });

  it("counts a 1-place move when it crosses a visibility band, and names the new band", () => {
    const points = talkingPoints(grid({ out: [20, 21], in: [101, 100] }), MONTHS, 10);
    expect(points).toEqual([
      { kind: "slipped", phrase: "out", text: "Fell from #20 to #21 - now partly visible" },
      { kind: "climbed", phrase: "in", text: "Climbed from outside the top 100 to #100" },
    ]);
  });

  it("says 'outside the top 100' for position 101", () => {
    expect(talkingPoints(grid({ gone: [40, 101] }), MONTHS)[0]?.text).toBe("Fell from #40 to outside the top 100 - now invisible");
  });

  it("pins the near-miss window to 21-30, singular at 21", () => {
    expect(kinds({ p20: [20, 20], p21: [21, 21], p30: [30, 30], p31: [31, 31] })).toEqual(["nearly:p21", "nearly:p30"]);
    expect(talkingPoints(grid({ p21: [21, 21] }), MONTHS)[0]?.text).toBe("At #21 - 1 place from the top 20");
    expect(talkingPoints(grid({ p24: [24, 24] }), MONTHS)[0]?.text).toBe("At #24 - 4 places from the top 20");
  });

  it("orders drops by size, near misses by position, gains by size, then applies the limit", () => {
    const rows = grid({ upSmall: [40, 36], near28: [28, 28], downSmall: [5, 9], near22: [22, 22], downBig: [10, 40], upBig: [90, 45] });
    expect(talkingPoints(rows, MONTHS, 10).map((p) => p.phrase)).toEqual(["downBig", "downSmall", "near22", "near28", "upBig", "upSmall"]);
    expect(talkingPoints(rows, MONTHS).map((p) => p.phrase)).toEqual(["downBig", "downSmall", "near22", "near28"]);
  });

  it("skips phrases with no latest data, and still finds near misses without a previous month", () => {
    expect(kinds({ blank: [5, null], missing: [5, undefined], new: [undefined, 25], wasBlank: [null, 5] })).toEqual(["nearly:new"]);
    expect(talkingPoints(grid({ a: [undefined, 25] }), ["2026-10-01"])).toEqual([{ kind: "nearly", phrase: "a", text: "At #25 - 5 places from the top 20" }]);
  });

  it("returns nothing when there are no months", () => {
    expect(talkingPoints(grid({ a: [10, 30] }), [])).toEqual([]);
  });
});

describe("dashboardStats", () => {
  const counts = (visible: number, partly: number, invisible: number, noData = 0) => ({ counts: { visible, partly, invisible, noData } });
  const lead = (id: string, status: "lead" | "client", last_ranking_pull: string | null = null) => ({ id, status, last_ranking_pull });

  it("counts leads and clients, shares visibility across both, and finds the newest pull", () => {
    const leads = [lead("a", "lead", "2026-10-05T09:00:00Z"), lead("b", "lead"), lead("c", "client", "2026-10-08T09:00:00Z"), lead("d", "lead", "2026-10-07T09:00:00Z")];
    const visibility = new Map([
      ["a", counts(3, 1, 0, 5)],
      ["c", counts(1, 1, 2)],
    ]);
    expect(dashboardStats(leads, visibility)).toEqual({ leadCount: 3, clientCount: 1, visibleShare: 50, lastPull: "2026-10-08T09:00:00Z" });
  });

  it("has no visible share or last pull when nothing has been ranked", () => {
    expect(dashboardStats([lead("a", "lead")], new Map([["a", counts(0, 0, 0, 4)]]))).toEqual({ leadCount: 1, clientCount: 0, visibleShare: null, lastPull: null });
  });
});

describe("initials", () => {
  it.each([
    ["BrightClean Industrial Ltd", "BI"],
    ["apex", "A"],
    ["  ", "?"],
  ])("%j -> %s", (name, expected) => {
    expect(initials(name)).toBe(expected);
  });
});
