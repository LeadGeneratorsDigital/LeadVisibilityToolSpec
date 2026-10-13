import type { SerpResponse } from "./dataforseo";
import { positionFromRankGroup, STATUS_NO_SEARCH_RESULTS, STATUS_OK } from "./dataforseo";
import { domainMatches } from "./domain";
import { NOT_RANKED_POSITION } from "./visibility";

/** One organic result kept from a SERP check. Ads and snippets are dropped - they never count as rank. */
export interface SnapshotItem {
  rank: number;
  domain: string;
  url: string;
  title: string;
}

export interface SnapshotData {
  cost: number;
  items: SnapshotItem[];
}

/** Snapshot lookup key. Google ignores case and repeated spaces, so these must not cause a second paid check. */
export function keywordKey(keyword: string): string {
  return keyword.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * The reusable part of a SERP response, or null when it must not be reused.
 * Only a complete result set can prove a domain is absent, so partial (40106) and failed responses are never kept.
 */
export function snapshotFromResponse(response: SerpResponse): SnapshotData | null {
  if (response.status_code !== STATUS_OK) return null;
  const task = response.tasks?.[0];
  if (!task) return null;
  if (task.status_code === STATUS_NO_SEARCH_RESULTS) return { cost: task.cost, items: [] };
  if (task.status_code !== STATUS_OK) return null;
  const items = task.result?.[0]?.items;
  if (!items) return null;
  return {
    cost: task.cost,
    items: items.filter((item) => item.type === "organic").map((item) => ({ rank: item.rank_group, domain: item.domain, url: item.url, title: item.title })),
  };
}

/** Same answer extractOrganicRank gives for the response the snapshot came from (pinned in serp-snapshot.test.ts). */
export function rankInSnapshot(items: SnapshotItem[], leadDomain: string): number {
  const hit = items.find((item) => domainMatches(item.domain, leadDomain));
  return hit ? positionFromRankGroup(hit.rank) : NOT_RANKED_POSITION;
}
