import type { MonthKey, SerpResponse, SerpTask } from "@lvt/shared";
import { buildMockSerpResponse } from "@lvt/shared";

export interface SerpContext {
  /** Only the mock uses this; the live API finds the domain on its own. */
  targetDomain: string;
  month: MonthKey;
}

export interface SerpClient {
  readonly mode: "mock" | "live" | "sandbox";
  /**
   * True when a response depends only on keyword + location, so it can be saved and reused for any lead.
   * The mock builds each SERP around one lead's domain, so reusing it would rank other leads as absent.
   * Sandbox answers are dummy data: saved, they would be reused as real checks after switching to live.
   */
  readonly reusable: boolean;
  fetchSerp(task: SerpTask, context: SerpContext): Promise<SerpResponse>;
}

export const LIVE_ENDPOINT = "https://api.dataforseo.com/v3/serp/google/organic/live/regular";
/** Free for any DataForSEO account; same request and response shape, dummy results (appendix/sandbox). */
export const SANDBOX_ENDPOINT = "https://sandbox.dataforseo.com/v3/serp/google/organic/live/regular";

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
export function createLiveSerpClient(
  login: string,
  password: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 120_000,
  environment: "live" | "sandbox" = "live",
): SerpClient {
  const authorization = `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`;
  const endpoint = environment === "live" ? LIVE_ENDPOINT : SANDBOX_ENDPOINT;
  return {
    mode: environment,
    reusable: environment === "live",
    async fetchSerp(task) {
      const res = await fetchImpl(endpoint, {
        method: "POST",
        headers: { Authorization: authorization, "Content-Type": "application/json" },
        body: JSON.stringify([task]),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        // The body's own code decides fatal vs per-phrase: an unverified account answers HTTP 403 with 40104.
        const body = (await res.json().catch(() => null)) as { status_code?: unknown; status_message?: unknown } | null;
        if (typeof body?.status_code === "number" && body.status_code !== 20000) {
          return failure(body.status_code, typeof body.status_message === "string" ? body.status_message : `HTTP ${res.status}`);
        }
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
    reusable: false,
    async fetchSerp(task, context) {
      if (options.latencyMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, options.latencyMs * (0.5 + random())));
      }
      return buildMockSerpResponse(task, { targetDomain: context.targetDomain, month: context.month, errorRate: options.errorRate, random });
    },
  };
}
