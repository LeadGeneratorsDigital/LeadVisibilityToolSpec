import { domainMatches } from "./domain";
import { NOT_RANKED_POSITION } from "./visibility";

/**
 * Subset of POST /v3/serp/google/organic/live/regular used by the tool.
 * Field names and status codes follow https://docs.dataforseo.com/v3/serp/google/organic/live/regular/
 * and https://docs.dataforseo.com/v3/appendix/errors/.
 */
export interface SerpTask {
  keyword: string;
  location_code: number;
  language_code: "en";
  device: "desktop";
  os: "windows";
  depth: number;
}

export type SerpItemType = "organic" | "paid" | "featured_snippet";

export interface SerpItem {
  type: SerpItemType;
  rank_group: number;
  rank_absolute: number;
  page: number;
  domain: string;
  title: string;
  description: string | null;
  url: string;
  breadcrumb: string | null;
}

export interface SerpResult {
  keyword: string;
  type: "organic";
  se_domain: string;
  location_code: number;
  language_code: string;
  check_url: string;
  datetime: string;
  item_types: string[];
  se_results_count: number;
  items_count: number;
  items: SerpItem[] | null;
}

export interface SerpTaskResponse {
  id: string;
  status_code: number;
  status_message: string;
  time: string;
  cost: number;
  result_count: number;
  path: string[];
  data: Record<string, unknown>;
  result: SerpResult[] | null;
}

export interface SerpResponse {
  version: string;
  status_code: number;
  status_message: string;
  time: string;
  cost: number;
  tasks_count: number;
  tasks_error: number;
  tasks: SerpTaskResponse[] | null;
}

export const STATUS_OK = 20000;
export const STATUS_NO_SEARCH_RESULTS = 40102;
export const STATUS_PARTIAL_RESULTS = 40106;

/** Account-level failures: every further call would fail the same way, so the pull stops. */
export const FATAL_STATUS_CODES: ReadonlySet<number> = new Set([40100, 40104, 40200, 40201, 40203, 40207, 40210]);

/** Results requested per phrase. The domain must appear in this window to get a position. */
export const SERP_DEPTH = 100;

export function buildSerpTask(keyword: string, locationCode: number): SerpTask {
  return { keyword, location_code: locationCode, language_code: "en", device: "desktop", os: "windows", depth: SERP_DEPTH };
}

export type RankOutcome =
  | { kind: "ranked"; position: number }
  | { kind: "error"; fatal: boolean; statusCode: number; message: string };

/** A hit past the requested depth is outside the window the position is defined for. */
export function positionFromRankGroup(rankGroup: number): number {
  return rankGroup > SERP_DEPTH ? NOT_RANKED_POSITION : rankGroup;
}

function error(statusCode: number, message: string): RankOutcome {
  return { kind: "error", fatal: FATAL_STATUS_CODES.has(statusCode), statusCode, message };
}

/**
 * Since late October 2026 Live answers leave most results as a google.com/goto redirect, with
 * `domain` set to Google's, because DataForSEO only resolves part of them in Live mode.
 */
export function isGotoUrl(url: string): boolean {
  return /^https?:\/\/(?:www\.)?google\.[a-z.]+\/goto\?/i.test(url);
}

/** The address Google prints above a result ("https://www.mws.ltd.uk › news"); a video prints its views instead. */
export function breadcrumbHost(breadcrumb: string | null): string | null {
  return /^https?:\/\/([^\s/›?#]+)/i.exec(breadcrumb ?? "")?.[1] ?? null;
}

/** The site an organic result belongs to, or null when a GoTo link hides it. */
export function organicDomain(item: Pick<SerpItem, "url" | "domain" | "breadcrumb">): string | null {
  return isGotoUrl(item.url) ? breadcrumbHost(item.breadcrumb) : item.domain;
}

/** GoTo links whose site cannot be read from the result itself, for the URL converter. */
export function unreadGotoUrls(response: SerpResponse): string[] {
  const items = response.tasks?.[0]?.result?.[0]?.items ?? [];
  return items.filter((item) => item.type === "organic" && organicDomain(item) === null).map((item) => item.url);
}

/** A copy of the response with each converted GoTo link replaced by its destination, so `domain` is the real site. */
export function withResolvedUrls(response: SerpResponse, resolved: ReadonlyMap<string, string>): SerpResponse {
  const result = response.tasks?.[0]?.result?.[0];
  if (!result?.items || resolved.size === 0) return response;
  const items = result.items.map((item) => {
    const url = resolved.get(item.url);
    if (!url) return item;
    try {
      return { ...item, url, domain: new URL(url).hostname };
    } catch {
      return item;
    }
  });
  const task = response.tasks![0]!;
  return { ...response, tasks: [{ ...task, result: [{ ...result, items }, ...task.result!.slice(1)] }, ...response.tasks!.slice(1)] };
}

/**
 * Turns one live SERP response into the lead's organic rank.
 * - Uses `rank_group` of the first organic item whose site (organicDomain) matches (ads and snippets are not organic rank).
 * - Domain absent from a complete result set -> NOT_RANKED_POSITION.
 * - Domain absent but some GoTo links unread -> an error (stored as NULL); a hit still counts.
 * - "No search results" (40102) is a valid empty SERP -> NOT_RANKED_POSITION.
 * - Partial results (40106) cannot prove absence, so a miss is an error (stored as NULL), a hit still counts.
 * - Any other non-20000 status is an error (spec section 6: blank on error, no retry).
 */
export function extractOrganicRank(response: SerpResponse, leadDomain: string): RankOutcome {
  if (response.status_code !== STATUS_OK) {
    return error(response.status_code, response.status_message);
  }
  const task = response.tasks?.[0];
  if (!task) return error(response.status_code, "Response contained no task");

  if (task.status_code === STATUS_NO_SEARCH_RESULTS) {
    return { kind: "ranked", position: NOT_RANKED_POSITION };
  }
  const partial = task.status_code === STATUS_PARTIAL_RESULTS;
  if (task.status_code !== STATUS_OK && !partial) {
    return error(task.status_code, task.status_message);
  }

  const items = task.result?.[0]?.items;
  if (!items) return error(task.status_code, "Task returned no result items");

  let unread = 0;
  const hit = items.find((item) => {
    if (item.type !== "organic") return false;
    const domain = organicDomain(item);
    if (domain === null) unread++;
    return domain !== null && domainMatches(domain, leadDomain);
  });
  if (hit) {
    return { kind: "ranked", position: positionFromRankGroup(hit.rank_group) };
  }
  if (partial) return error(task.status_code, task.status_message);
  // Like a partial result: a hidden site could be the lead's, so "not in the top 100" is not proven.
  if (unread > 0) return error(0, `${unread} Google links could not be read, so the site may be among them`);
  return { kind: "ranked", position: NOT_RANKED_POSITION };
}
