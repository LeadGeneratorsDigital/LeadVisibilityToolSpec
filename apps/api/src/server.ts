import { createClient } from "@supabase/supabase-js";
import pLimit from "p-limit";
import { buildApp } from "./app";
import { createAnthropicBriefMerger, createDisabledBriefMerger, createMockBriefMerger } from "./brief";
import { briefMode, loadConfig } from "./config";
import { createLiveSerpClient, createMockSerpClient } from "./serp-client";
import { createSupabasePullRepo } from "./supabase-repo";
import { findWebDist } from "./web-dist";

const config = loadConfig();
const db = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const serp =
  config.DATAFORSEO_MODE === "live"
    ? createLiveSerpClient(config.DATAFORSEO_LOGIN!, config.DATAFORSEO_PASSWORD!, fetch, config.DATAFORSEO_TIMEOUT_MS)
    : createMockSerpClient({ errorRate: config.MOCK_ERROR_RATE, latencyMs: config.MOCK_LATENCY_MS });

const mode = briefMode(config);
const brief =
  mode === "claude"
    ? createAnthropicBriefMerger(config.ANTHROPIC_API_KEY!, config.ANTHROPIC_MODEL)
    : mode === "mock"
      ? createMockBriefMerger()
      : createDisabledBriefMerger();

const repo = createSupabasePullRepo(db);
// No pull survives a restart (see PullDeps.inFlight), so every "running" row is an orphan at boot.
await repo.failInterruptedRuns();

const webDist = findWebDist(config.WEB_DIST, import.meta.url);
const app = await buildApp({
  corsOrigin: config.CORS_ORIGIN,
  verifyToken: async (token) => {
    const { data, error } = await db.auth.getUser(token);
    return error ? null : (data.user?.id ?? null);
  },
  pull: { repo, serp, limit: pLimit(config.PULL_CONCURRENCY), inFlight: new Set() },
  brief,
  webDist,
});

await app.listen({ port: config.PORT, host: "0.0.0.0" });
console.log(`API on :${config.PORT} - DataForSEO ${serp.mode}, brief ${brief.mode}, web ${webDist ?? "not served"}`);
