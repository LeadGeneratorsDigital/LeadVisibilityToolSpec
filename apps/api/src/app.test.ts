import { describe, expect, it } from "vitest";
import { buildApp } from "./app";
import type { BriefMerger } from "./brief";
import { FakeRepo, scriptedSerp, serpWithOrganic, unlimited } from "./test-support";

const LEAD_ID = "6f1c2c1e-1111-4a4a-9b9b-000000000001";
const AUTH = { authorization: "Bearer good-token" };

async function setup(brief?: Partial<BriefMerger>) {
  const repo = new FakeRepo();
  repo.addLead(LEAD_ID, ["a"]);
  const work: Promise<void>[] = [];
  const inFlight = new Set<string>();
  const merger: BriefMerger = { mode: "mock", merge: async (b, n) => `${b}|${n}`, ...brief };
  const app = await buildApp({
    corsOrigin: "http://localhost:5173",
    verifyToken: async (token) => (token === "good-token" ? "user-1" : null),
    pull: { repo, serp: scriptedSerp(() => serpWithOrganic(["lead.co.uk"])), limit: unlimited, inFlight },
    brief: merger,
    onBackgroundWork: (w) => work.push(w),
  });
  return { app, repo, inFlight, settle: () => Promise.all(work) };
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
});

describe("GET /api/health", () => {
  it("reports the active modes without auth", async () => {
    const { app } = await setup();
    expect((await app.inject({ method: "GET", url: "/api/health" })).json()).toEqual({ ok: true, serpMode: "mock", briefMode: "mock" });
  });
});
