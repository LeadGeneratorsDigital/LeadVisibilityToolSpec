import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";

const base = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" };

describe("loadConfig", () => {
  it("defaults to mock DataForSEO and the spec model", () => {
    expect(loadConfig(base)).toMatchObject({ DATAFORSEO_MODE: "mock", ANTHROPIC_MODEL: "claude-haiku-4-5", PULL_CONCURRENCY: 10 });
  });

  it("live mode requires DataForSEO credentials", () => {
    expect(() => loadConfig({ ...base, DATAFORSEO_MODE: "live" })).toThrow(/DATAFORSEO_LOGIN/);
    expect(loadConfig({ ...base, DATAFORSEO_MODE: "live", DATAFORSEO_LOGIN: "a", DATAFORSEO_PASSWORD: "b" }).DATAFORSEO_MODE).toBe("live");
  });

  it("rejects concurrency above the DataForSEO simultaneous-request cap", () => {
    expect(() => loadConfig({ ...base, PULL_CONCURRENCY: "31" })).toThrow(/PULL_CONCURRENCY/);
  });

  it("requires Supabase credentials", () => {
    expect(() => loadConfig({})).toThrow(/SUPABASE_URL/);
  });

  it("refuses mock DataForSEO or the mock brief merger in production unless ALLOW_MOCKS=true", () => {
    const prod = { ...base, NODE_ENV: "production" };
    const live = { DATAFORSEO_MODE: "live", DATAFORSEO_LOGIN: "a", DATAFORSEO_PASSWORD: "b" };
    expect(() => loadConfig({ ...prod, ANTHROPIC_API_KEY: "sk" })).toThrow(/DATAFORSEO_MODE/);
    expect(() => loadConfig({ ...prod, ...live })).toThrow(/ANTHROPIC_API_KEY/);
    expect(loadConfig({ ...prod, ...live, ANTHROPIC_API_KEY: "sk" }).DATAFORSEO_MODE).toBe("live");
    expect(loadConfig({ ...prod, ALLOW_MOCKS: "true" }).DATAFORSEO_MODE).toBe("mock");
  });
});
