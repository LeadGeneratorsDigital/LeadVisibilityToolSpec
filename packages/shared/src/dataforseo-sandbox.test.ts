import { describe, expect, it } from "vitest";
import type { SerpResponse } from "./dataforseo";
import { buildSerpTask, extractOrganicRank } from "./dataforseo";
import { buildMockSerpResponse } from "./dataforseo-mock";
import { rankInSnapshot, snapshotFromResponse } from "./serp-snapshot";
import { NOT_RANKED_POSITION } from "./visibility";
import fixture from "./fixtures/sandbox-serp-organic.json";

/**
 * Unedited answer from sandbox.dataforseo.com for the live/regular endpoint (dummy "pizza" SERP).
 * Organic rank_group and rank_absolute differ there (#1 is absolute 5), which is what these tests pin.
 */
const sandbox = fixture as unknown as SerpResponse;
const realItems = sandbox.tasks![0]!.result![0]!.items!;

describe("real DataForSEO response (sandbox fixture)", () => {
  it("is the shape the parser expects", () => {
    expect(sandbox.status_code).toBe(20000);
    expect(sandbox.tasks![0]!.status_code).toBe(20000);
    expect(realItems).toHaveLength(10);
    expect(realItems.every((item) => item.type === "organic")).toBe(true);
    expect(realItems[0]).toMatchObject({ rank_group: 1, rank_absolute: 5, domain: "www.tripadvisor.co.uk" });
  });

  it.each([
    ["www.tripadvisor.co.uk", 1],
    ["dominos.co.uk", 2],
    ["https://www.pizzapilgrims.co.uk/menu", 3],
    ["facebook.com", 10],
  ])("%s ranks at its organic rank_group %i, not rank_absolute", (domain, rank) => {
    expect(extractOrganicRank(sandbox, domain)).toEqual({ kind: "ranked", position: rank });
  });

  it("a domain missing from a complete result set is not in the top 100", () => {
    expect(extractOrganicRank(sandbox, "lead.co.uk")).toEqual({ kind: "ranked", position: NOT_RANKED_POSITION });
  });

  it("the saved snapshot keeps rank_group and gives the same rank as the live parse", () => {
    const snapshot = snapshotFromResponse(sandbox)!;
    expect(snapshot.cost).toBe(0);
    expect(snapshot.items).toHaveLength(10);
    expect(snapshot.items[1]).toEqual({
      rank: 2,
      domain: "www.dominos.co.uk",
      url: realItems[1]!.url,
      title: realItems[1]!.title,
    });
    for (const domain of ["www.tripadvisor.co.uk", "dominos.co.uk", "facebook.com", "lead.co.uk"]) {
      const live = extractOrganicRank(sandbox, domain);
      expect(live.kind === "ranked" && live.position).toBe(rankInSnapshot(snapshot.items, domain));
    }
  });
});

function keysOf(value: object | null | undefined): string[] {
  return Object.keys(value ?? {}).sort();
}

describe("mock response stays a subset of the real response", () => {
  const mock = buildMockSerpResponse(buildSerpTask("scaffolding hire london", 1006886), {
    targetDomain: "lead.co.uk",
    month: "2026-10-01",
    errorRate: 0,
    random: () => 0.5,
  });
  const mockTask = mock.tasks![0]!;
  const realTask = sandbox.tasks![0]!;

  it.each([
    ["envelope", mock, sandbox],
    ["task", mockTask, realTask],
    ["result", mockTask.result![0], realTask.result![0]],
    ["organic item", mockTask.result![0]!.items!.find((item) => item.type === "organic"), realItems[0]],
  ])("every %s field the mock sets exists in the real response", (_level, mockPart, realPart) => {
    const real = new Set(keysOf(realPart));
    expect(keysOf(mockPart).filter((key) => !real.has(key))).toEqual([]);
  });
});
