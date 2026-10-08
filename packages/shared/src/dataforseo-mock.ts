import type { SerpItem, SerpResponse, SerpTask, SerpTaskResponse } from "./dataforseo";
import { SERP_DEPTH, STATUS_OK } from "./dataforseo";
import { normalizeDomain } from "./domain";
import type { MonthKey } from "./month";

/** Per-phrase task errors the live API can return (appendix/errors). Each is stored as NULL. */
export const MOCK_TASK_ERRORS: ReadonlyArray<{ code: number; message: string }> = [
  { code: 40101, message: "Internal SE Server Error." },
  { code: 40103, message: "Task execution failed, please try to resubmit the task." },
  { code: 50000, message: "Internal Error." },
  { code: 50401, message: "Internal Error - Timeout." },
];

const COMPETITOR_SUFFIXES = ["specialists", "services", "group", "direct", "pro", "solutions", "uk", "experts", "co", "hub"];
const DIRECTORY_DOMAINS = [
  "www.yell.com",
  "www.checkatrade.com",
  "www.trustatrader.com",
  "www.bark.com",
  "www.mybuilder.com",
  "uk.trustpilot.com",
  "www.ratedpeople.com",
  "www.freeindex.co.uk",
  "www.thomsonlocal.com",
  "www.scoot.co.uk",
];

function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 - small deterministic PRNG so a phrase/month always produces the same SERP. */
function seededRandom(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Organic rank the mock gives `domain` for `keyword` in `month`, or null when it is outside the top 100.
 * The base rank is fixed per keyword+domain and drifts a few places per month, so history looks plausible.
 * Mix: ~30% 1-20, ~30% 21-50, ~25% 51-100, ~15% absent.
 */
export function mockOrganicRank(keyword: string, domain: string, month: MonthKey): number | null {
  const base = seededRandom(hashSeed(`${keyword}|${normalizeDomain(domain)}`));
  const bucket = base();
  if (bucket >= 0.85) return null;
  const [lo, hi] = bucket < 0.3 ? [1, 20] : bucket < 0.6 ? [21, 50] : [51, 100];
  const baseRank = lo + Math.floor(base() * (hi - lo + 1));
  const drift = Math.floor(seededRandom(hashSeed(`${keyword}|${domain}|${month}`))() * 9) - 4;
  return Math.min(SERP_DEPTH, Math.max(1, baseRank + drift));
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function item(type: SerpItem["type"], rankGroup: number, rankAbsolute: number, domain: string, keyword: string): SerpItem {
  return {
    type,
    rank_group: rankGroup,
    rank_absolute: rankAbsolute,
    page: Math.ceil(rankAbsolute / 10),
    domain,
    title: `${keyword.replace(/\b\w/g, (c) => c.toUpperCase())} | ${domain.replace(/^www\./, "")}`,
    description: `Trusted ${keyword} - get a free quote today.`,
    url: `https://${domain}/${slug(keyword)}`,
    breadcrumb: type === "organic" ? `https://${domain} › ${slug(keyword)}` : null,
  };
}

function competitorDomain(keyword: string, index: number): string {
  if (index < DIRECTORY_DOMAINS.length && index % 3 === 1) return DIRECTORY_DOMAINS[index]!;
  const words = slug(keyword).split("-").slice(0, 2).join("");
  return `www.${words}${COMPETITOR_SUFFIXES[index % COMPETITOR_SUFFIXES.length]}${index}.co.uk`;
}

function envelope(task: SerpTask, taskResponse: Omit<SerpTaskResponse, "path" | "data" | "time" | "cost">): SerpResponse {
  const isError = taskResponse.status_code !== STATUS_OK;
  return {
    version: "0.1.20260101",
    status_code: STATUS_OK,
    status_message: "Ok.",
    time: "1.0213 sec.",
    cost: isError ? 0 : 0.002,
    tasks_count: 1,
    tasks_error: isError ? 1 : 0,
    tasks: [
      {
        ...taskResponse,
        time: "0.9871 sec.",
        cost: isError ? 0 : 0.002,
        path: ["v3", "serp", "google", "organic", "live", "regular"],
        data: { api: "serp", function: "live", se: "google", se_type: "organic", ...task },
      },
    ],
  };
}

export interface MockSerpOptions {
  /** Domain to place in the organic results (the live API discovers it; the mock has to be told). */
  targetDomain: string;
  month: MonthKey;
  /** Probability that a call returns a task error. */
  errorRate: number;
  /** Source of per-call randomness for errors, so a second pull can succeed where the first failed. */
  random?: () => number;
  /** Fixed ISO id for the task; defaults to a value derived from the keyword. */
  taskId?: string;
}

export function buildMockSerpResponse(task: SerpTask, options: MockSerpOptions): SerpResponse {
  const random = options.random ?? Math.random;
  const taskId = options.taskId ?? `mock-${hashSeed(task.keyword).toString(16)}`;

  if (random() < options.errorRate) {
    const err = MOCK_TASK_ERRORS[Math.floor(random() * MOCK_TASK_ERRORS.length)]!;
    return envelope(task, { id: taskId, status_code: err.code, status_message: err.message, result_count: 0, result: null });
  }

  const serp = seededRandom(hashSeed(`${task.keyword}|${options.month}|layout`));
  const leadRank = mockOrganicRank(task.keyword, options.targetDomain, options.month);
  const leadHost = `www.${normalizeDomain(options.targetDomain)}`;

  const items: SerpItem[] = [];
  let absolute = 0;
  const paidCount = Math.floor(serp() * 4);
  for (let i = 1; i <= paidCount; i++) items.push(item("paid", i, ++absolute, competitorDomain(task.keyword, 50 + i), task.keyword));
  const hasSnippet = serp() < 0.25;
  if (hasSnippet) items.push(item("featured_snippet", 1, ++absolute, competitorDomain(task.keyword, 70), task.keyword));

  for (let rank = 1, competitor = 0; rank <= Math.min(task.depth, SERP_DEPTH); rank++) {
    const domain = rank === leadRank ? leadHost : competitorDomain(task.keyword, competitor++);
    items.push(item("organic", rank, ++absolute, domain, task.keyword));
  }

  const itemTypes = [...(paidCount ? ["paid"] : []), ...(hasSnippet ? ["featured_snippet"] : []), "organic"];
  return envelope(task, {
    id: taskId,
    status_code: STATUS_OK,
    status_message: "Ok.",
    result_count: 1,
    result: [
      {
        keyword: task.keyword,
        type: "organic",
        se_domain: "google.co.uk",
        location_code: task.location_code,
        language_code: task.language_code,
        check_url: `https://www.google.co.uk/search?q=${encodeURIComponent(task.keyword)}&num=100&hl=en&gl=GB`,
        datetime: new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, " +00:00"),
        item_types: itemTypes,
        se_results_count: 1_000_000 + Math.floor(serp() * 50_000_000),
        items_count: items.length,
        items,
      },
    ],
  });
}
