import { describe, expect, it } from "vitest";
import type { SerpItem, SerpResponse } from "./dataforseo";
import { breadcrumbHost, buildSerpTask, extractOrganicRank, isGotoUrl, organicDomain, positionFromRankGroup, SERP_DEPTH, unreadGotoUrls, withResolvedUrls } from "./dataforseo";
import liveGoto from "./fixtures/live-serp-goto.json";

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

  it("keeps position 100 (the last requested slot) and records 101 past the depth", () => {
    expect(positionFromRankGroup(SERP_DEPTH)).toBe(100);
    expect(positionFromRankGroup(SERP_DEPTH + 1)).toBe(101);
    expect(extractOrganicRank(response([serpItem("organic", 100, 104, "www.brightclean.co.uk")]), LEAD)).toEqual({ kind: "ranked", position: 100 });
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

/** First 16 organic results of a real Live answer ("portable weighbridge", UK, 3 Nov 2026): 12 are GoTo links, 3 of them videos. */
const gotoSerp = liveGoto as SerpResponse;
const gotoItems = gotoSerp.tasks![0]!.result![0]!.items!;
const videoUrls = [7, 11, 16].map((rank) => gotoItems.find((item) => item.rank_group === rank)!.url);

describe("GoTo links", () => {
  it.each([
    ["https://google.com/goto?url=CAES", true],
    ["https://www.google.co.uk/goto?url=CAES", true],
    ["https://www.google.com/search?q=goto", false],
    ["https://support.google.com/goto?url=x", false],
    ["https://example.com/goto?url=x", false],
    ["https://example.com/out?to=https://google.com/goto?url=CAES", false],
  ])("isGotoUrl(%s) is %s", (url, expected) => {
    expect(isGotoUrl(url)).toBe(expected);
  });

  it.each([
    ["https://www.mws.ltd.uk › what-is-a-weighbridge", "www.mws.ltd.uk"],
    ["https://weighbridgeservices.com", "weighbridgeservices.com"],
    ["https://b2bwiki.baidu.com › porta...", "b2bwiki.baidu.com"],
    ["1.5k+ views  ·  2 years ago", null],
    ["Shared from https://spam.example · 2 years ago", null],
    [null, null],
  ])("breadcrumbHost(%s) is %s", (breadcrumb, expected) => {
    expect(breadcrumbHost(breadcrumb)).toBe(expected);
  });

  it("reads a GoTo result's site from its breadcrumb and a normal result's from its domain", () => {
    expect(gotoItems.slice(0, 7).map(organicDomain)).toEqual(["www.mws.ltd.uk", "nuweigh.com.au", "libraweighing.co.uk", "www.griffith-elder.com", "caliberscales.wixsite.com", "www.scalesmart.com", null]);
  });

  it.each([
    ["mws.ltd.uk", 1],
    ["henerscale.com", 14],
    ["ebay.co.uk", 13],
  ])("ranks %s behind a GoTo link or not at %i", (lead, position) => {
    expect(extractOrganicRank(gotoSerp, lead)).toEqual({ kind: "ranked", position });
  });

  it("a miss with unread links is an error, not Not Ranked", () => {
    expect(extractOrganicRank(gotoSerp, "absent.co.uk")).toEqual({ kind: "error", fatal: false, statusCode: 0, message: "3 Google links could not be read, so the site may be among them" });
  });

  it("lists the links only a converter can read, in rank order", () => {
    expect(unreadGotoUrls(gotoSerp)).toEqual(videoUrls);
  });

  it("converted links count like normal results; a link left unconverted still blocks Not Ranked", () => {
    const two = withResolvedUrls(gotoSerp, new Map([[videoUrls[0]!, "https://www.youtube.com/watch?v=a"], [videoUrls[1]!, "https://www.youtube.com/watch?v=b"]]));
    expect(extractOrganicRank(two, "youtube.com")).toEqual({ kind: "ranked", position: 7 });
    expect(unreadGotoUrls(two)).toEqual([videoUrls[2]]);
    expect(extractOrganicRank(two, "absent.co.uk")).toMatchObject({ kind: "error", message: "1 Google links could not be read, so the site may be among them" });

    const all = withResolvedUrls(two, new Map([[videoUrls[2]!, "https://www.facebook.com/watch/1"]]));
    expect(extractOrganicRank(all, "absent.co.uk")).toEqual({ kind: "ranked", position: 101 });
    expect(extractOrganicRank(all, "facebook.com")).toEqual({ kind: "ranked", position: 16 });
  });

  it("withResolvedUrls leaves the input alone and skips a destination that is not a URL", () => {
    const before = JSON.stringify(gotoSerp);
    const out = withResolvedUrls(gotoSerp, new Map([[videoUrls[0]!, "not a url"]]));
    expect(JSON.stringify(gotoSerp)).toBe(before);
    expect(unreadGotoUrls(out)).toEqual(videoUrls);
  });
});
