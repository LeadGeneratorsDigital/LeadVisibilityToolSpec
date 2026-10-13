import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { currentMonthKey } from "@lvt/shared";
import { describe, expect, it } from "vitest";
import { buildApp } from "./app";
import { type BriefMerger, createDisabledBriefMerger } from "./brief";
import { FakeRepo, scriptedSerp, serpWithOrganic, unlimited } from "./test-support";

const LEAD_ID = "6f1c2c1e-1111-4a4a-9b9b-000000000001";
const AUTH = { authorization: "Bearer good-token" };

async function setup(brief?: Partial<BriefMerger>, webDist: string | null = null) {
  const repo = new FakeRepo();
  repo.addLead(LEAD_ID, ["a"]);
  const work: Promise<void>[] = [];
  const inFlight = new Set<string>();
  const merger: BriefMerger = { mode: "mock", merge: async (b, n) => `${b}|${n}`, ...brief };
  const serp = scriptedSerp(() => serpWithOrganic(["lead.co.uk"]));
  const app = await buildApp({
    corsOrigin: "http://localhost:5173",
    verifyToken: async (token) => (token === "good-token" ? "user-1" : null),
    pull: { repo, serp, limit: unlimited, inFlight },
    brief: merger,
    onBackgroundWork: (w) => work.push(w),
    webDist,
  });
  return { app, repo, serp, inFlight, settle: () => Promise.all(work) };
}

describe("auth gate", () => {
  it.each([
    ["no header", {}],
    ["wrong scheme", { authorization: "Basic good-token" }],
    ["invalid token", { authorization: "Bearer nope" }],
  ])("401 with %s", async (_label, headers) => {
    const { app, repo } = await setup();
    for (const url of [`/api/leads/${LEAD_ID}/pull`, "/api/pull-all", "/api/brief/merge"]) {
      const res = await app.inject({ method: "POST", url, headers, payload: { brief: "", notes: "x" } });
      expect(res.statusCode, url).toBe(401);
    }
    expect(repo.runs).toEqual([]);
  });

  it("a verifier that throws is a 401, not a 500", async () => {
    const repo = new FakeRepo();
    const app = await buildApp({
      corsOrigin: "*",
      verifyToken: async () => {
        throw new Error("supabase down");
      },
      pull: { repo, serp: scriptedSerp(() => serpWithOrganic([])), limit: unlimited, inFlight: new Set<string>() },
      brief: { mode: "mock", merge: async () => "" },
    });
    expect((await app.inject({ method: "POST", url: "/api/pull-all", headers: AUTH })).statusCode).toBe(401);
  });
});

describe("POST /api/leads/:id/pull", () => {
  it("202 with the run id, and the run completes in the background", async () => {
    const { app, repo, settle } = await setup();
    const res = await app.inject({ method: "POST", url: `/api/leads/${LEAD_ID}/pull`, headers: AUTH });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ runId: "run-1" });
    await settle();
    expect(repo.runs[0]!.status).toBe("succeeded");
  });

  it("without force, a phrase already ranked this month is not checked again", async () => {
    const { app, repo, serp, settle } = await setup();
    repo.rankings.set(`${LEAD_ID}-p0|${currentMonthKey(new Date())}`, 14);
    expect((await app.inject({ method: "POST", url: `/api/leads/${LEAD_ID}/pull`, headers: AUTH })).statusCode).toBe(202);
    await settle();
    expect(serp.calls).toEqual([]);
  });

  it("{ force: true } checks it again and overwrites the month", async () => {
    const { app, repo, serp, settle } = await setup();
    const month = currentMonthKey(new Date());
    repo.rankings.set(`${LEAD_ID}-p0|${month}`, 14);
    const res = await app.inject({ method: "POST", url: `/api/leads/${LEAD_ID}/pull`, headers: AUTH, payload: { force: true } });
    expect(res.statusCode).toBe(202);
    await settle();
    expect(serp.calls).toEqual(["a"]);
    expect(repo.ranking(`${LEAD_ID}-p0`, month)).toBe(1);
  });

  it.each([[{ force: "yes" }], [{ force: true, extra: 1 }]])("400 for body %j, and no run starts", async (payload) => {
    const { app, repo } = await setup();
    expect((await app.inject({ method: "POST", url: `/api/leads/${LEAD_ID}/pull`, headers: AUTH, payload })).statusCode).toBe(400);
    expect(repo.runs).toEqual([]);
  });

  it("400 for a non-uuid id", async () => {
    const { app } = await setup();
    expect((await app.inject({ method: "POST", url: "/api/leads/not-a-uuid/pull", headers: AUTH })).statusCode).toBe(400);
  });

  it("404 for an unknown lead", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "POST", url: "/api/leads/6f1c2c1e-1111-4a4a-9b9b-000000000999/pull", headers: AUTH });
    expect(res.statusCode).toBe(404);
  });

  it("409 while a pull is already running", async () => {
    const { app, inFlight } = await setup();
    inFlight.add(LEAD_ID);
    expect((await app.inject({ method: "POST", url: `/api/leads/${LEAD_ID}/pull`, headers: AUTH })).statusCode).toBe(409);
  });
});

describe("JSON body parsing", () => {
  it("accepts a JSON content-type with an empty body (browser fetch on the pull routes)", async () => {
    const { app, settle } = await setup();
    const res = await app.inject({ method: "POST", url: "/api/pull-all", headers: { ...AUTH, "content-type": "application/json" }, payload: "" });
    expect(res.statusCode).toBe(202);
    await settle();
  });

  it("still rejects malformed JSON with 400", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "POST", url: "/api/brief/merge", headers: { ...AUTH, "content-type": "application/json" }, payload: "{not json" });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /api/pull-all", () => {
  it("202 listing started and skipped leads", async () => {
    const { app, settle } = await setup();
    const res = await app.inject({ method: "POST", url: "/api/pull-all", headers: AUTH });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ started: [{ leadId: LEAD_ID, runId: "run-1" }], skipped: [] });
    await settle();
  });
});

describe("POST /api/brief/merge", () => {
  it("returns the merged brief and does not persist anything", async () => {
    const { app, repo } = await setup();
    const res = await app.inject({ method: "POST", url: "/api/brief/merge", headers: AUTH, payload: { brief: "old", notes: "new" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ brief: "old|new", mode: "mock" });
    expect(repo.runs).toEqual([]);
  });

  it.each([
    [{ brief: "old", notes: "   " }],
    [{ brief: "old" }],
    [{ notes: "x" }],
  ])("400 for %j", async (payload) => {
    const { app } = await setup();
    expect((await app.inject({ method: "POST", url: "/api/brief/merge", headers: AUTH, payload })).statusCode).toBe(400);
  });

  it("502 with a safe message when the model call fails", async () => {
    const { app } = await setup({
      merge: async () => {
        throw new Error("anthropic 529 overloaded sk-secret");
      },
    });
    const res = await app.inject({ method: "POST", url: "/api/brief/merge", headers: AUTH, payload: { brief: "", notes: "x" } });
    expect(res.statusCode).toBe(502);
    expect(res.body).not.toContain("sk-secret");
  });

  it("503 saying it is not set up when brief merging is off (production without a Claude key)", async () => {
    const { app } = await setup(createDisabledBriefMerger());
    const res = await app.inject({ method: "POST", url: "/api/brief/merge", headers: AUTH, payload: { brief: "", notes: "x" } });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: "Brief updates are not set up - a Claude API key is needed" });
    expect((await app.inject({ method: "GET", url: "/api/health" })).json()).toMatchObject({ briefMode: "off" });
  });
});

describe("GET /api/health", () => {
  it("reports the active modes without auth", async () => {
    const { app } = await setup();
    expect((await app.inject({ method: "GET", url: "/api/health" })).json()).toEqual({ ok: true, serpMode: "mock", briefMode: "mock" });
  });
});

describe("serving the built web app (single-host deploy)", () => {
  function webBuild() {
    const dir = mkdtempSync(join(tmpdir(), "lvt-dist-"));
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "index.html"), "<!doctype html><title>shell</title>");
    writeFileSync(join(dir, "assets", "index-abc123.js"), "console.log(1)");
    writeFileSync(join(dir, "favicon.svg"), "<svg/>");
    return dir;
  }

  it("serves index.html at / and for client-side routes, never cached", async () => {
    const { app } = await setup(undefined, webBuild());
    for (const url of ["/", "/leads/6f1c2c1e-1111-4a4a-9b9b-000000000001", "/login?next=%2F"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(200);
      expect(res.body, url).toContain("<title>shell</title>");
      expect(res.headers["cache-control"], url).toBe("no-cache");
    }
  });

  it("serves hashed assets with a long immutable cache, and other files with no-cache", async () => {
    const { app } = await setup(undefined, webBuild());
    const asset = await app.inject({ method: "GET", url: "/assets/index-abc123.js" });
    expect(asset.statusCode).toBe(200);
    expect(asset.body).toBe("console.log(1)");
    expect(asset.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect((await app.inject({ method: "GET", url: "/favicon.svg" })).headers["cache-control"]).toBe("no-cache");
  });

  it.each(["/api/nope", "/api", "/api?x=1"])("unknown API path %s stays a JSON 404, not the app shell", async (url) => {
    const { app } = await setup(undefined, webBuild());
    const res = await app.inject({ method: "GET", url });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Not found" });
  });

  it("a path that only starts with 'api' is a client route, not the API", async () => {
    const { app } = await setup(undefined, webBuild());
    for (const url of ["/apikeys", "/leads/api", "/leads/api/x"]) {
      expect((await app.inject({ method: "GET", url })).body, url).toContain("<title>shell</title>");
    }
  });

  it("non-GET requests to unknown paths are 404, not the app shell", async () => {
    const { app } = await setup(undefined, webBuild());
    expect((await app.inject({ method: "POST", url: "/leads/x" })).statusCode).toBe(404);
  });

  it("the API routes still answer when the web app is served", async () => {
    const { app } = await setup(undefined, webBuild());
    expect((await app.inject({ method: "GET", url: "/api/health" })).json()).toMatchObject({ ok: true });
    expect((await app.inject({ method: "POST", url: `/api/leads/${LEAD_ID}/pull` })).statusCode).toBe(401);
  });

  it("without a web build only /api is served", async () => {
    const { app } = await setup();
    for (const url of ["/", "/leads/x"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(404);
      expect(res.json().message, url).toBe(`Route GET:${url} not found`);
    }
  });
});
