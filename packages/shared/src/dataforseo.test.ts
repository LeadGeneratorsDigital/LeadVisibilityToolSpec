import { describe, expect, it } from "vitest";
import type { SerpItem, SerpResponse } from "./dataforseo";
import { buildSerpTask, extractOrganicRank } from "./dataforseo";

const LEAD = "brightclean.co.uk";

function serpItem(type: SerpItem["type"], rankGroup: number, rankAbsolute: number, domain: string): SerpItem {
  return { type, rank_group: rankGroup, rank_absolute: rankAbsolute, page: 1, domain, title: "t", description: null, url: `https://${domain}/`, breadcrumb: null };
}

function response(items: SerpItem[] | null, taskStatus = 20000, topStatus = 20000): SerpResponse {
  return {
    version: "0.1",
    status_code: topStatus,
    status_message: topStatus === 20000 ? "Ok." : "Top-level failure",
    time: "1 sec.",
    cost: 0,
    tasks_count: 1,
    tasks_error: taskStatus === 20000 ? 0 : 1,
    tasks: [
      {
        id: "t1",
        status_code: taskStatus,
        status_message: `status ${taskStatus}`,
        time: "1 sec.",
        cost: 0,
        result_count: items ? 1 : 0,
        path: [],
        data: {},
        result: items
          ? [{ keyword: "k", type: "organic", se_domain: "google.co.uk", location_code: 2826, language_code: "en", check_url: "", datetime: "", item_types: [], se_results_count: 0, items_count: items.length, items }]
          : null,
      },
    ],
  };
}

describe("buildSerpTask", () => {
  it("sends the spec section 8 parameters", () => {
    expect(buildSerpTask("scaffolding hire london", 1006886)).toEqual({
      keyword: "scaffolding hire london",
      location_code: 1006886,
      language_code: "en",
      device: "desktop",
      os: "windows",
      depth: 100,
    });
  });
});

describe("extractOrganicRank", () => {
  it("uses rank_group of the organic hit, ignoring ads and snippets above it", () => {
    const items = [
      serpItem("paid", 1, 1, "www.brightclean.co.uk"),
      serpItem("featured_snippet", 1, 2, "www.brightclean.co.uk"),
      serpItem("organic", 1, 3, "www.rival.co.uk"),
      serpItem("organic", 2, 4, "www.brightclean.co.uk"),
    ];
    expect(extractOrganicRank(response(items), LEAD)).toEqual({ kind: "ranked", position: 2 });
  });

  it("takes the first organic hit when the domain appears twice", () => {
    const items = [serpItem("organic", 5, 5, "brightclean.co.uk"), serpItem("organic", 9, 9, "www.brightclean.co.uk")];
    expect(extractOrganicRank(response(items), LEAD)).toEqual({ kind: "ranked", position: 5 });
  });

  it("records 101 when the domain is absent from a complete result set", () => {
    expect(extractOrganicRank(response([serpItem("organic", 1, 1, "www.rival.co.uk")]), LEAD)).toEqual({ kind: "ranked", position: 101 });
  });

  it("records 101 for 'no search results' (40102) - an empty SERP is a valid answer", () => {
    expect(extractOrganicRank(response(null, 40102), LEAD)).toEqual({ kind: "ranked", position: 101 });
  });

  it("partial results (40106) still count a hit", () => {
    expect(extractOrganicRank(response([serpItem("organic", 7, 7, "www.brightclean.co.uk")], 40106), LEAD)).toEqual({ kind: "ranked", position: 7 });
  });

  it("partial results (40106) cannot prove absence, so a miss is an error", () => {
    const outcome = extractOrganicRank(response([serpItem("organic", 1, 1, "www.rival.co.uk")], 40106), LEAD);
    expect(outcome).toMatchObject({ kind: "error", fatal: false, statusCode: 40106 });
  });

  it.each([40101, 40103, 50000, 50401])("task error %i is a non-fatal error (stored as NULL)", (code) => {
    expect(extractOrganicRank(response(null, code), LEAD)).toMatchObject({ kind: "error", fatal: false, statusCode: code });
  });

  it.each([40100, 40200, 40210])("account error %i is fatal", (code) => {
    expect(extractOrganicRank(response(null, code), LEAD)).toMatchObject({ kind: "error", fatal: true, statusCode: code });
  });

  it("a top-level failure is an error even if the task looks fine", () => {
    const outcome = extractOrganicRank(response([serpItem("organic", 1, 1, "www.brightclean.co.uk")], 20000, 40200), LEAD);
    expect(outcome).toMatchObject({ kind: "error", fatal: true, statusCode: 40200 });
  });

  it("a 20000 task with no items is an error, not 'not ranked'", () => {
    expect(extractOrganicRank(response(null), LEAD)).toMatchObject({ kind: "error", statusCode: 20000 });
  });

  it("an empty tasks array is an error", () => {
    expect(extractOrganicRank({ ...response([]), tasks: [] }, LEAD)).toMatchObject({ kind: "error" });
  });
});
