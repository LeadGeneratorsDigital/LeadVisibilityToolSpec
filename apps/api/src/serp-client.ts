import type { MonthKey, SerpResponse, SerpTask } from "@lvt/shared";
import { buildMockSerpResponse } from "@lvt/shared";

export interface SerpContext {
  /** Only the mock uses this; the live API finds the domain on its own. */
  targetDomain: string;
  month: MonthKey;
}

export interface SerpClient {
  readonly mode: "mock" | "live";
  fetchSerp(task: SerpTask, context: SerpContext): Promise<SerpResponse>;
}

export const LIVE_ENDPOINT = "https://api.dataforseo.com/v3/serp/google/organic/live/regular";

/** DataForSEO answers 200 except for these HTTP codes (appendix/errors); map them to the internal codes. */
const HTTP_TO_STATUS: Record<number, { code: number; message: string }> = {
  401: { code: 40100, message: "Unauthorized - check DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD" },
  402: { code: 40200, message: "Payment required - check the DataForSEO balance" },
};

function failure(code: number, message: string): SerpResponse {
  return { version: "", status_code: code, status_message: message, time: "0", cost: 0, tasks_count: 0, tasks_error: 0, tasks: null };
}

/**
 * A request that times out rejects, which the pull records like any other per-phrase error (NULL).
 * Without a timeout a hung request would hold a concurrency slot and keep its run "running" forever.
 */
export function createLiveSerpClient(login: string, password: string, fetchImpl: typeof fetch = fetch, timeoutMs = 120_000): SerpClient {
  const authorization = `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`;
  return {
    mode: "live",
    async fetchSerp(task) {
      const res = await fetchImpl(LIVE_ENDPOINT, {
        method: "POST",
        headers: { Authorization: authorization, "Content-Type": "application/json" },
        body: JSON.stringify([task]),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        const mapped = HTTP_TO_STATUS[res.status] ?? { code: 50000, message: `HTTP ${res.status}` };
        return failure(mapped.code, mapped.message);
      }
      return (await res.json()) as SerpResponse;
    },
  };
}

export function createMockSerpClient(options: { errorRate: number; latencyMs: number; random?: () => number }): SerpClient {
  const random = options.random ?? Math.random;
  return {
    mode: "mock",
    async fetchSerp(task, context) {
      if (options.latencyMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, options.latencyMs * (0.5 + random())));
      }
      return buildMockSerpResponse(task, { targetDomain: context.targetDomain, month: context.month, errorRate: options.errorRate, random });
    },
  };
}
