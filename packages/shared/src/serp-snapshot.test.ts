import { describe, expect, it } from "vitest";
import type { SerpItem, SerpResponse } from "./dataforseo";
import { extractOrganicRank } from "./dataforseo";
import { keywordKey, rankInSnapshot, snapshotFromResponse } from "./serp-snapshot";

const LEAD = "brightclean.co.uk";

function item(type: SerpItem["type"], rankGroup: number, domain: string): SerpItem {
  return { type, rank_group: rankGroup, rank_absolute: rankGroup, page: 1, domain, title: `${domain} title`, description: null, url: `https://${domain}/`, breadcrumb: null };
}

function response(items: SerpItem[] | null, taskStatus = 20000, topStatus = 20000, cost = 0.002): SerpResponse {
  return {
    version: "0.1",
    status_code: topStatus,
    status_message: "m",
    time: "1 sec.",
    cost,
    tasks_count: 1,
    tasks_error: 0,
    tasks: [
      {
        id: "t1",
        status_code: taskStatus,
        status_message: "m",
        time: "1 sec.",
        cost,
        result_count: 1,
        path: [],
        data: {},
        result: items ? [{ keyword: "k", type: "organic", se_domain: "google.co.uk", location_code: 2826, language_code: "en", check_url: "", datetime: "", item_types: [], se_results_count: 0, items_count: items.length, items }] : null,
      },
    ],
  };
}

describe("keywordKey", () => {
  it("ignores case, outer spaces and repeated inner spaces", () => {
    expect(keywordKey("  Scaffolding   Hire London ")).toBe("scaffolding hire london");
  });

  it("keeps different words apart", () => {
    expect(keywordKey("scaffolding hire london")).not.toBe(keywordKey("scaffolding hire leeds"));
  });
});

describe("snapshotFromResponse", () => {
  it("keeps organic results only, with rank, domain, url, title and the task cost", () => {
    const snapshot = snapshotFromResponse(response([item("paid", 1, "ads.co.uk"), item("organic", 1, "www.rival.co.uk"), item("featured_snippet", 1, "snip.co.uk")], 20000, 20000, 0.0035));
    expect(snapshot).toEqual({ cost: 0.0035, items: [{ rank: 1, domain: "www.rival.co.uk", url: "https://www.rival.co.uk/", title: "www.rival.co.uk title" }] });
  });

  it("'no search results' (40102) is a complete, empty result set", () => {
    expect(snapshotFromResponse(response(null, 40102))).toEqual({ cost: 0.002, items: [] });
  });

  it.each([
    ["partial results (40106)", response([item("organic", 1, "x.co.uk")], 40106)],
    ["a task error", response(null, 50000)],
    ["a top-level failure", response([item("organic", 1, "x.co.uk")], 20000, 40200)],
    ["a 20000 task with no items", response(null)],
    ["no task", { ...response([]), tasks: [] }],
  ])("is null for %s - it cannot prove a domain is absent", (_label, res) => {
    expect(snapshotFromResponse(res)).toBeNull();
  });
});

describe("rankInSnapshot matches extractOrganicRank on the response it came from", () => {
  it.each([
    ["an organic hit below an ad and a snippet for the same domain", [item("paid", 1, "www.brightclean.co.uk"), item("featured_snippet", 1, "brightclean.co.uk"), item("organic", 1, "rival.co.uk"), item("organic", 2, "www.brightclean.co.uk")], 2],
    ["the first of two organic hits", [item("organic", 5, "brightclean.co.uk"), item("organic", 9, "www.brightclean.co.uk")], 5],
    ["an absent domain", [item("organic", 1, "rival.co.uk")], 101],
    ["a hit past the requested depth", [item("organic", 105, "brightclean.co.uk")], 101],
  ])("%s", (_label, items, expected) => {
    const res = response(items);
    expect(extractOrganicRank(res, LEAD)).toEqual({ kind: "ranked", position: expected });
    expect(rankInSnapshot(snapshotFromResponse(res)!.items, LEAD)).toBe(expected);
  });

  it("an empty SERP (40102) is not ranked", () => {
    expect(rankInSnapshot(snapshotFromResponse(response(null, 40102))!.items, LEAD)).toBe(101);
  });

  it("one snapshot answers for every lead domain in it", () => {
    const items = snapshotFromResponse(response([item("organic", 1, "a.co.uk"), item("organic", 2, "b.co.uk")]))!.items;
    expect([rankInSnapshot(items, "a.co.uk"), rankInSnapshot(items, "b.co.uk"), rankInSnapshot(items, "c.co.uk")]).toEqual([1, 2, 101]);
  });
});
