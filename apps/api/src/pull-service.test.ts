import pLimit from "p-limit";
import { describe, expect, it, vi } from "vitest";
import { INTERRUPTED_RUN_ERROR, LeadNotFoundError, PullConflictError, startLeadPull, startPullAll } from "./pull-service";
import { FakeRepo, scriptedSerp, serpTaskError, serpWithOrganic, unlimited } from "./test-support";

const NOW = new Date("2026-10-08T10:00:00Z");
const MONTH = "2026-10-01";
const now = () => NOW;

async function pullOnce(repo: FakeRepo, serp: ReturnType<typeof scriptedSerp>, leadId = "L") {
  const pull = await startLeadPull({ repo, serp, limit: unlimited, inFlight: new Set<string>(), now }, leadId);
  await pull.done;
  return repo.runs.find((r) => r.id === pull.runId)!;
}

describe("startLeadPull", () => {
  it("stores the organic rank, marks the run succeeded and stamps last_ranking_pull", async () => {
    const repo = new FakeRepo();
    repo.addLead("L", ["a", "b"]);
    const serp = scriptedSerp((k) => serpWithOrganic(k === "a" ? ["rival.co.uk", "www.lead.co.uk"] : ["rival.co.uk"]));

    const run = await pullOnce(repo, serp);

    expect(repo.ranking("L-p0", MONTH)).toBe(2);
    expect(repo.ranking("L-p1", MONTH)).toBe(101);
    expect(run).toMatchObject({ status: "succeeded", phrases_done: 2, phrases_failed: 0, error: null });
    expect(repo.leads.get("L")!.last_ranking_pull).toEqual(NOW);
  });

  it("blank on error: a failing phrase is NULL, is not retried, and the other phrases still save", async () => {
    const repo = new FakeRepo();
    repo.addLead("L", ["ok", "bad"]);
    const serp = scriptedSerp((k) => (k === "bad" ? serpTaskError(50000) : serpWithOrganic(["lead.co.uk"])));

    const run = await pullOnce(repo, serp);

    expect(repo.ranking("L-p0", MONTH)).toBe(1);
    expect(repo.ranking("L-p1", MONTH)).toBeNull();
    expect(serp.calls.filter((k) => k === "bad")).toHaveLength(1);
    expect(run).toMatchObject({ status: "succeeded", phrases_done: 2, phrases_failed: 1 });
  });

  it("a network exception for one phrase is treated like a task error", async () => {
    const repo = new FakeRepo();
    repo.addLead("L", ["ok", "boom"]);
    const serp = scriptedSerp((k) => (k === "boom" ? new Error("ECONNRESET") : serpWithOrganic(["lead.co.uk"])));

    const run = await pullOnce(repo, serp);

    expect(repo.ranking("L-p1", MONTH)).toBeNull();
    expect(run).toMatchObject({ status: "succeeded", phrases_failed: 1 });
  });

  it("an error never erases a position already stored for the month; a later success overwrites it", async () => {
    const repo = new FakeRepo();
    repo.addLead("L", ["a"]);
    repo.rankings.set(`L-p0|${MONTH}`, 14);

    await pullOnce(repo, scriptedSerp(() => serpTaskError(40103)));
    expect(repo.ranking("L-p0", MONTH)).toBe(14);

    await pullOnce(repo, scriptedSerp(() => serpWithOrganic(["x.co.uk", "y.co.uk", "lead.co.uk"])));
    expect(repo.ranking("L-p0", MONTH)).toBe(3);
  });

  it("a second manual pull fills a blank left by the first", async () => {
    const repo = new FakeRepo();
    repo.addLead("L", ["a"]);
    await pullOnce(repo, scriptedSerp(() => serpTaskError(50401)));
    expect(repo.ranking("L-p0", MONTH)).toBeNull();

    await pullOnce(repo, scriptedSerp(() => serpWithOrganic(["lead.co.uk"])));
    expect(repo.ranking("L-p0", MONTH)).toBe(1);
  });

  it("every phrase failing marks the run failed and leaves last_ranking_pull alone", async () => {
    const repo = new FakeRepo();
    repo.addLead("L", ["a", "b"]);

    const run = await pullOnce(repo, scriptedSerp(() => serpTaskError(40101)));

    expect(run).toMatchObject({ status: "failed", phrases_done: 2, phrases_failed: 2 });
    expect(run.error).toMatch(/Every phrase failed/);
    expect(repo.leads.get("L")!.last_ranking_pull).toBeNull();
  });

  it("an account-level error stops the lead and does not write NULLs for the remaining phrases", async () => {
    const repo = new FakeRepo();
    repo.addLead("L", ["a", "b", "c"]);
    const serp = scriptedSerp(() => serpTaskError(40200, "payment required."));

    const pull = await startLeadPull({ repo, serp, limit: pLimit(1), inFlight: new Set<string>(), now }, "L");
    await pull.done;
    const run = repo.runs[0]!;

    expect(serp.calls).toEqual(["a"]);
    expect(run.status).toBe("failed");
    expect(run.error).toBe("DataForSEO 40200: payment required.");
    expect(repo.ranking("L-p0", MONTH)).toBeUndefined();
    expect(repo.ranking("L-p2", MONTH)).toBeUndefined();
  });

  it("a database write failure marks the run failed after the other phrases finish", async () => {
    const repo = new FakeRepo();
    repo.addLead("L", ["a", "b"]);
    repo.failSaveRankingFor.add("L-p0");

    const run = await pullOnce(repo, scriptedSerp(() => serpWithOrganic(["lead.co.uk"])));

    expect(run.status).toBe("failed");
    expect(run.error).toBe("db write failed");
    expect(repo.ranking("L-p1", MONTH)).toBe(1);
  });

  it("stores against the London month, not the UTC month", async () => {
    const repo = new FakeRepo();
    repo.addLead("L", ["a"]);
    const pull = await startLeadPull(
      { repo, serp: scriptedSerp(() => serpWithOrganic(["lead.co.uk"])), limit: unlimited, inFlight: new Set<string>(), now: () => new Date("2026-09-30T23:30:00Z") },
      "L",
    );
    await pull.done;
    expect(repo.ranking("L-p0", "2026-10-01")).toBe(1);
    expect(repo.ranking("L-p0", "2026-09-01")).toBeUndefined();
  });

  it.each([
    [{ website_domain: null }, "Lead has no website domain"],
    [{ website_domain: "   " }, "Lead has no website domain"],
    [{ data4seo_location_code: null }, "Lead has no location"],
  ])("records a failed run without calling DataForSEO when %j", async (overrides, reason) => {
    const repo = new FakeRepo();
    repo.addLead("L", ["a"], overrides);
    const serp = scriptedSerp(() => serpWithOrganic([]));

    const run = await pullOnce(repo, serp);

    expect(run).toMatchObject({ status: "failed", error: reason });
    expect(serp.calls).toEqual([]);
  });

  it("records a failed run when the lead has no phrases", async () => {
    const repo = new FakeRepo();
    repo.addLead("L", []);
    expect(await pullOnce(repo, scriptedSerp(() => serpWithOrganic([])))).toMatchObject({ status: "failed", error: "Lead has no phrases to pull" });
  });

  it("throws LeadNotFoundError for an unknown lead", async () => {
    await expect(startLeadPull({ repo: new FakeRepo(), serp: scriptedSerp(() => serpWithOrganic([])), limit: unlimited, inFlight: new Set<string>(), now }, "nope")).rejects.toBeInstanceOf(LeadNotFoundError);
  });

  it("refuses a second pull for a lead while this process is still pulling it", async () => {
    const repo = new FakeRepo();
    repo.addLead("L", ["a"]);
    let release!: () => void;
    const serp = { mode: "mock" as const, fetchSerp: () => new Promise<ReturnType<typeof serpWithOrganic>>((r) => (release = () => r(serpWithOrganic([])))) };
    const deps = { repo, serp, limit: unlimited, inFlight: new Set<string>(), now };

    const first = await startLeadPull(deps, "L");
    await expect(startLeadPull(deps, "L")).rejects.toBeInstanceOf(PullConflictError);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    release();
    await first.done;
    await expect(startLeadPull(deps, "L")).resolves.toMatchObject({ runId: "run-2" });
  });

  it("two simultaneous requests for one lead start exactly one run", async () => {
    const repo = new FakeRepo();
    repo.addLead("L", ["a"]);
    const deps = { repo, serp: scriptedSerp(() => serpWithOrganic([])), limit: unlimited, inFlight: new Set<string>(), now };

    const results = await Promise.allSettled([startLeadPull(deps, "L"), startLeadPull(deps, "L")]);

    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(repo.runs).toHaveLength(1);
  });

  it("a run left 'running' by a process that died no longer blocks the lead and is marked interrupted", async () => {
    const repo = new FakeRepo();
    repo.addLead("L", ["a"]);
    await repo.createRun("L", 1);
    const deps = { repo, serp: scriptedSerp(() => serpWithOrganic(["lead.co.uk"])), limit: unlimited, inFlight: new Set<string>(), now };

    const pull = await startLeadPull(deps, "L");
    await pull.done;

    expect(repo.runs[0]).toMatchObject({ status: "failed", error: INTERRUPTED_RUN_ERROR });
    expect(repo.runs[1]).toMatchObject({ status: "succeeded" });
  });

  it("retries the final run write so a transient database error does not leave the run 'running'", async () => {
    const repo = new FakeRepo();
    repo.addLead("L", ["a"]);
    const update = repo.updateRun.bind(repo);
    let finalAttempts = 0;
    repo.updateRun = async (id, patch) => {
      if (patch.status && ++finalAttempts < 3) throw new Error("connection reset");
      return update(id, patch);
    };

    const pull = await startLeadPull({ repo, serp: scriptedSerp(() => serpWithOrganic(["lead.co.uk"])), limit: unlimited, inFlight: new Set<string>(), now, sleep: async () => {} }, "L");
    await pull.done;

    expect(finalAttempts).toBe(3);
    expect(repo.runs[0]!.status).toBe("succeeded");
  });
});

describe("startPullAll", () => {
  it("pulls every active lead, skips paused/converted, and one failing lead does not stop the rest", async () => {
    const repo = new FakeRepo();
    repo.addLead("A", ["a1"]);
    repo.addLead("B", ["b1"], { website_domain: null });
    repo.addLead("C", ["c1"]);
    repo.addLead("P", ["p1"], { status: "paused" });
    repo.addLead("X", ["x1"], { status: "converted" });
    const serp = scriptedSerp(() => serpWithOrganic(["lead.co.uk"]));

    const result = await startPullAll({ repo, serp, limit: unlimited, inFlight: new Set<string>(), now });
    await result.done;

    expect(result.started.map((s) => s.leadId).sort()).toEqual(["A", "B", "C"]);
    expect(repo.runs.find((r) => r.leadId === "B")).toMatchObject({ status: "failed" });
    expect(repo.ranking("A-p0", MONTH)).toBe(1);
    expect(repo.ranking("C-p0", MONTH)).toBe(1);
    expect(serp.calls.sort()).toEqual(["a1", "c1"]);
  });

  it("reports a lead that is already running as skipped", async () => {
    const repo = new FakeRepo();
    repo.addLead("A", ["a1"]);
    const result = await startPullAll({ repo, serp: scriptedSerp(() => serpWithOrganic([])), limit: unlimited, inFlight: new Set(["A"]), now });
    expect(result.skipped).toEqual([{ leadId: "A", reason: "A ranking pull is already running for this lead" }]);
  });

  it("runs leads in parallel under one shared concurrency limit", async () => {
    const repo = new FakeRepo();
    for (const id of ["A", "B", "C"]) repo.addLead(id, [`${id}1`, `${id}2`]);
    let inFlight = 0;
    let peak = 0;
    const serp = {
      mode: "mock" as const,
      async fetchSerp() {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return serpWithOrganic(["lead.co.uk"]);
      },
    };

    const result = await startPullAll({ repo, serp, limit: pLimit(2), inFlight: new Set<string>(), now });
    await result.done;

    expect(peak).toBe(2);
    expect(repo.runs.every((r) => r.status === "succeeded")).toBe(true);
  });

  it("an account-level error in one lead stops every other lead in the same pull-all", async () => {
    const repo = new FakeRepo();
    for (const id of ["A", "B", "C"]) repo.addLead(id, [`${id}1`, `${id}2`]);
    const serp = scriptedSerp(() => serpTaskError(40200, "payment required."));

    const result = await startPullAll({ repo, serp, limit: pLimit(1), inFlight: new Set<string>(), now });
    await result.done;

    expect(serp.calls).toEqual(["A1"]);
    expect(repo.runs.map((r) => [r.leadId, r.status, r.error])).toEqual([
      ["A", "failed", "DataForSEO 40200: payment required."],
      ["B", "failed", "Stopped - DataForSEO 40200: payment required."],
      ["C", "failed", "Stopped - DataForSEO 40200: payment required."],
    ]);
  });
});
