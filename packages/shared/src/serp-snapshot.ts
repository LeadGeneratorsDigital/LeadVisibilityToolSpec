import type { SerpResponse } from "./dataforseo";
import { isGotoUrl, organicDomain, positionFromRankGroup, STATUS_NO_SEARCH_RESULTS, STATUS_OK } from "./dataforseo";
import { domainMatches, normalizeDomain } from "./domain";
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
 * Only a complete result set can prove a domain is absent, so partial (40106) and failed responses are never kept,
 * nor is one with a GoTo link whose site is unread. `domain` is the real site, read from the breadcrumb for a GoTo link.
 */
export function snapshotFromResponse(response: SerpResponse): SnapshotData | null {
  if (response.status_code !== STATUS_OK) return null;
  const task = response.tasks?.[0];
  if (!task) return null;
  if (task.status_code === STATUS_NO_SEARCH_RESULTS) return { cost: task.cost, items: [] };
  if (task.status_code !== STATUS_OK) return null;
  const items = task.result?.[0]?.items;
  if (!items) return null;
  const kept: SnapshotItem[] = [];
  for (const item of items) {
    if (item.type !== "organic") continue;
    const domain = organicDomain(item);
    if (domain === null) return null;
    kept.push({ rank: item.rank_group, domain, url: item.url, title: item.title });
  }
  return { cost: task.cost, items: kept };
}

/**
 * True for a check saved before GoTo links were read (from 31 October 2026 until this fix): such an item
 * kept the link's own Google host as its domain, so reusing it would miss a lead behind such a link.
 */
export function hasUnreadLinks(items: SnapshotItem[]): boolean {
  return items.some((item) => isGotoUrl(item.url) && normalizeDomain(item.domain) === normalizeDomain(item.url));
}

/** Same answer extractOrganicRank gives for the response the snapshot came from (pinned in serp-snapshot.test.ts). */
export function rankInSnapshot(items: SnapshotItem[], leadDomain: string): number {
  const hit = items.find((item) => domainMatches(item.domain, leadDomain));
  return hit ? positionFromRankGroup(hit.rank) : NOT_RANKED_POSITION;
}
