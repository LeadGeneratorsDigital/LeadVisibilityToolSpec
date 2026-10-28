import { createClient } from "@supabase/supabase-js";
import pLimit from "p-limit";
import { buildApp } from "./app";
import { loadConfig } from "./config";
import { createLiveSerpClient, createMockSerpClient } from "./serp-client";
import { createSupabasePullRepo } from "./supabase-repo";
import { findWebDist } from "./web-dist";

const config = loadConfig();
const db = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const serp =
  config.DATAFORSEO_MODE === "mock"
    ? createMockSerpClient({ errorRate: config.MOCK_ERROR_RATE, latencyMs: config.MOCK_LATENCY_MS })
    : createLiveSerpClient(config.DATAFORSEO_LOGIN!, config.DATAFORSEO_PASSWORD!, fetch, config.DATAFORSEO_TIMEOUT_MS, config.DATAFORSEO_MODE);

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
  pingDatabase: async () => {
    const { error } = await db.from("location_codes").select("code").limit(1);
    if (error) throw new Error(error.message);
  },
  webDist,
});

await app.listen({ port: config.PORT, host: "0.0.0.0" });
console.log(`API on :${config.PORT} - DataForSEO ${serp.mode}, web ${webDist ?? "not served"}`);
