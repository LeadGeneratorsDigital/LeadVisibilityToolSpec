import pLimit from "p-limit";
import { describe, expect, it, vi } from "vitest";
import type { PullDeps, PullOptions } from "./pull-service";
import { INTERRUPTED_RUN_ERROR, LeadNotFoundError, PullConflictError, startLeadPull } from "./pull-service";
import { FakeRepo, scriptedSerp, serpTaskError, serpWithOrganic, unlimited } from "./test-support";

const NOW = new Date("2026-10-08T10:00:00Z");
const MONTH = "2026-10-01";
const now = () => NOW;

async function pullOnce(repo: FakeRepo, serp: ReturnType<typeof scriptedSerp>, leadId = "L", options: PullOptions = {}, extra: Partial<PullDeps> = {}) {
  const pull = await startLeadPull({ repo, serp, limit: unlimited, inFlight: new Set<string>(), now, ...extra }, leadId, options);
  await pull.done;
  return repo.runs.find((r) => r.id === pull.runId)!;
}

const DAY = 24 * 60 * 60 * 1000;

function savedCheck(repo: FakeRepo, keywordKey: string, fetchedAt: Date, domains: string[], locationCode = 2826) {
  const items = domains.map((domain, i) => ({ rank: i + 1, domain, url: `https://${domain}/`, title: "" }));
  repo.snapshots.push({ id: `seed-${repo.snapshots.length + 1}`, keywordKey, keyword: keywordKey, locationCode, cost: 0.002, items, fetchedAt });
  return repo.snapshots[repo.snapshots.length - 1]!.id;
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

  it("force: an error never erases a position already stored for the month; a later success overwrites it", async () => {
    const repo = new FakeRepo();
    repo.addLead("L", ["a"]);
    repo.rankings.set(`L-p0|${MONTH}`, 14);

    await pullOnce(repo, scriptedSerp(() => serpTaskError(40103)), "L", { force: true });
    expect(repo.ranking("L-p0", MONTH)).toBe(14);

    await pullOnce(repo, scriptedSerp(() => serpWithOrganic(["x.co.uk", "y.co.uk", "lead.co.uk"])), "L", { force: true });
    expect(repo.ranking("L-p0", MONTH)).toBe(3);
  });

  it("skips phrases already ranked this month: no DataForSEO call, and they count as done", async () => {
    const repo = new FakeRepo();
    repo.addLead("L", ["a", "b"]);
    repo.rankings.set(`L-p0|${MONTH}`, 14);
    const serp = scriptedSerp(() => serpWithOrganic(["lead.co.uk"]));

    const run = await pullOnce(repo, serp);

    expect(serp.calls).toEqual(["b"]);
    expect(repo.ranking("L-p0", MONTH)).toBe(14);
    expect(repo.ranking("L-p1", MONTH)).toBe(1);
    expect(run).toMatchObject({ status: "succeeded", phrases_total: 2, phrases_done: 2, phrases_failed: 0 });
  });

  it("a phrase ranked only in an earlier month is checked again", async () => {
    const repo = new FakeRepo();
    repo.addLead("L", ["a"]);
    repo.rankings.set("L-p0|2026-09-01", 14);
    const serp = scriptedSerp(() => serpWithOrganic(["lead.co.uk"]));

    await pullOnce(repo, serp);

    expect(serp.calls).toEqual(["a"]);
    expect(repo.ranking("L-p0", MONTH)).toBe(1);
  });

  it("a pull where every phrase is already ranked succeeds without calls and leaves last_ranking_pull alone", async () => {
    const repo = new FakeRepo();
    repo.addLead("L", ["a"]);
    repo.rankings.set(`L-p0|${MONTH}`, 14);
    const serp = scriptedSerp(() => serpWithOrganic(["lead.co.uk"]));

    const run = await pullOnce(repo, serp);

    expect(serp.calls).toEqual([]);
    expect(run).toMatchObject({ status: "succeeded", phrases_done: 1, phrases_failed: 0, error: null });
    expect(repo.leads.get("L")!.last_ranking_pull).toBeNull();
  });

  it("force checks every phrase again, including ones already ranked this month", async () => {
    const repo = new FakeRepo();
    repo.addLead("L", ["a"]);
    repo.rankings.set(`L-p0|${MONTH}`, 14);
    const serp = scriptedSerp(() => serpWithOrganic(["lead.co.uk"]));

    await pullOnce(repo, serp, "L", { force: true });

    expect(serp.calls).toEqual(["a"]);
    expect(repo.ranking("L-p0", MONTH)).toBe(1);
  });

  it("archived phrases are not pulled", async () => {
    const repo = new FakeRepo();
    repo.addLead("L", ["kept", "archived"]);
    repo.phrases.get("L")![1]!.archived = true;
    const serp = scriptedSerp(() => serpWithOrganic(["lead.co.uk"]));

    const run = await pullOnce(repo, serp);

    expect(serp.calls).toEqual(["kept"]);
    expect(run.phrases_total).toBe(1);
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
    const serp = { mode: "mock" as const, reusable: true, fetchSerp: () => new Promise<ReturnType<typeof serpWithOrganic>>((r) => (release = () => r(serpWithOrganic([])))) };
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

  it("only one API instance is supported: a second process marks the first one's live run interrupted and starts its own", async () => {
    const repo = new FakeRepo();
    repo.addLead("L", ["a"]);
    let release!: () => void;
    const slow = { mode: "live" as const, reusable: true, fetchSerp: () => new Promise<ReturnType<typeof serpWithOrganic>>((r) => (release = () => r(serpWithOrganic(["lead.co.uk"])))) };
    const first = await startLeadPull({ repo, serp: slow, limit: unlimited, inFlight: new Set<string>(), now }, "L");

    const second = await startLeadPull({ repo, serp: scriptedSerp(() => serpWithOrganic(["lead.co.uk"])), limit: unlimited, inFlight: new Set<string>(), now }, "L");
    await second.done;

    expect(repo.runs.map((r) => r.status)).toEqual(["failed", "succeeded"]);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    release();
    await first.done;
  });

  it("a conflict from the database's one-running-run rule is a PullConflictError and frees the lead", async () => {
    const repo = new FakeRepo();
    repo.addLead("L", ["a"]);
    repo.createRun = async () => {
      throw new PullConflictError("A ranking pull is already running for this lead");
    };
    const inFlight = new Set<string>();

    await expect(startLeadPull({ repo, serp: scriptedSerp(() => serpWithOrganic([])), limit: unlimited, inFlight, now }, "L")).rejects.toBeInstanceOf(PullConflictError);
    expect(inFlight.has("L")).toBe(false);
  });
});

describe("saved checks", () => {
  it("saves every complete check and links the ranking to it with the check time", async () => {
    const repo = new FakeRepo();
    repo.addLead("L", ["Scaffolding Hire"]);

    await pullOnce(repo, scriptedSerp(() => serpWithOrganic(["rival.co.uk", "www.lead.co.uk"], 0.0035)));

    expect(repo.snapshots).toEqual([
      {
        id: "snap-1",
        keywordKey: "scaffolding hire",
        keyword: "Scaffolding Hire",
        locationCode: 2826,
        cost: 0.0035,
        items: [
          { rank: 1, domain: "rival.co.uk", url: "https://rival.co.uk/", title: "" },
          { rank: 2, domain: "www.lead.co.uk", url: "https://www.lead.co.uk/", title: "" },
        ],
        fetchedAt: NOW,
      },
    ]);
    expect(repo.ranking("L-p0", MONTH)).toBe(2);
    expect(repo.check("L-p0", MONTH)).toEqual({ checkedAt: NOW, snapshotId: "snap-1" });
  });

  it("a partial result still ranks a hit but is not saved for reuse", async () => {
    const repo = new FakeRepo();
    repo.addLead("L", ["a"]);
    const partial = serpWithOrganic(["lead.co.uk"]);
    partial.tasks![0]!.status_code = 40106;

    await pullOnce(repo, scriptedSerp(() => partial));

    expect(repo.ranking("L-p0", MONTH)).toBe(1);
    expect(repo.snapshots).toEqual([]);
    expect(repo.check("L-p0", MONTH)).toEqual({ checkedAt: NOW, snapshotId: null });
  });

  it("reuses a check from this month inside the max age: no call, this lead's own position, the original check time", async () => {
    const repo = new FakeRepo();
    repo.addLead("L", ["a"]);
    const fetchedAt = new Date(NOW.getTime() - 2 * DAY);
    const id = savedCheck(repo, "a", fetchedAt, ["rival.co.uk", "other.co.uk", "lead.co.uk"]);
    const serp = scriptedSerp(() => serpWithOrganic(["lead.co.uk"]));

    const run = await pullOnce(repo, serp);

    expect(serp.calls).toEqual([]);
    expect(repo.ranking("L-p0", MONTH)).toBe(3);
    expect(repo.check("L-p0", MONTH)).toEqual({ checkedAt: fetchedAt, snapshotId: id });
    expect(repo.snapshots).toHaveLength(1);
    expect(run).toMatchObject({ status: "succeeded", phrases_done: 1 });
    expect(repo.leads.get("L")!.last_ranking_pull).toEqual(NOW);
  });

  it.each([
    ["inside", 59, 0],
    ["outside", 61, 1],
  ])("a check %s the max age (%i min old, max 60) makes %i calls", async (_label, minutes, calls) => {
    const repo = new FakeRepo();
    repo.addLead("L", ["a"]);
    savedCheck(repo, "a", new Date(NOW.getTime() - minutes * 60_000), ["lead.co.uk"]);
    const serp = scriptedSerp(() => serpWithOrganic(["lead.co.uk"]));

    await pullOnce(repo, serp, "L", {}, { snapshotMaxAgeMs: 60 * 60_000 });

    expect(serp.calls).toHaveLength(calls);
  });

  it("the default max age is 7 days", async () => {
    const repo = new FakeRepo();
    repo.addLead("A", ["a"]);
    repo.addLead("B", ["b"]);
    savedCheck(repo, "a", new Date(NOW.getTime() - 7 * DAY + 60_000), ["lead.co.uk"]);
    savedCheck(repo, "b", new Date(NOW.getTime() - 7 * DAY - 60_000), ["lead.co.uk"]);
    const serp = scriptedSerp(() => serpWithOrganic(["lead.co.uk"]));

    await pullOnce(repo, serp, "A");
    await pullOnce(repo, serp, "B");

    expect(serp.calls).toEqual(["b"]);
  });

  it("a recent check from last month never fills this month's column", async () => {
    const repo = new FakeRepo();
    repo.addLead("L", ["a"]);
    // 30 Sep 21:30 in London: inside 7 days of 1 Oct 10:00, but September.
    savedCheck(repo, "a", new Date("2026-09-30T20:30:00Z"), ["lead.co.uk"]);
    const serp = scriptedSerp(() => serpWithOrganic(["x.co.uk", "lead.co.uk"]));

    await pullOnce(repo, serp, "L", {}, { now: () => new Date("2026-10-01T10:00:00Z") });

    expect(serp.calls).toEqual(["a"]);
    expect(repo.ranking("L-p0", MONTH)).toBe(2);
  });

  it("matches saved checks by keyword ignoring case and spacing, but never across locations", async () => {
    const repo = new FakeRepo();
    repo.addLead("A", ["  Scaffolding   HIRE "]);
    repo.addLead("B", ["scaffolding hire"], { data4seo_location_code: 1006886 });
    savedCheck(repo, "scaffolding hire", new Date(NOW.getTime() - DAY), ["lead.co.uk"]);
    const serp = scriptedSerp(() => serpWithOrganic(["lead.co.uk"]));

    await pullOnce(repo, serp, "A");
    await pullOnce(repo, serp, "B");

    expect(serp.calls).toEqual(["scaffolding hire"]);
  });

  it("force ignores saved checks and saves a new one", async () => {
    const repo = new FakeRepo();
    repo.addLead("L", ["a"]);
    savedCheck(repo, "a", new Date(NOW.getTime() - DAY), ["lead.co.uk"]);
    const serp = scriptedSerp(() => serpWithOrganic(["x.co.uk", "lead.co.uk"]));

    await pullOnce(repo, serp, "L", { force: true });

    expect(serp.calls).toEqual(["a"]);
    expect(repo.ranking("L-p0", MONTH)).toBe(2);
    expect(repo.snapshots).toHaveLength(2);
    expect(repo.check("L-p0", MONTH)).toEqual({ checkedAt: NOW, snapshotId: "snap-2" });
  });

  it("a non-reusable (mock) client never reads or writes saved checks", async () => {
    const repo = new FakeRepo();
    repo.addLead("L", ["a"]);
    savedCheck(repo, "a", new Date(NOW.getTime() - DAY), ["lead.co.uk"]);
    const serp = scriptedSerp(() => serpWithOrganic(["x.co.uk", "lead.co.uk"]), false);

    await pullOnce(repo, serp);

    expect(serp.calls).toEqual(["a"]);
    expect(repo.ranking("L-p0", MONTH)).toBe(2);
    expect(repo.snapshots).toHaveLength(1);
    expect(repo.check("L-p0", MONTH)).toEqual({ checkedAt: NOW, snapshotId: null });
  });

  it("a failed snapshot write keeps the paid position, unlinked", async () => {
    const repo = new FakeRepo();
    repo.addLead("L", ["a"]);
    repo.failSaveSnapshot = true;
    const warn = vi.fn();

    const run = await pullOnce(repo, scriptedSerp(() => serpWithOrganic(["lead.co.uk"])), "L", {}, { warn });

    expect(repo.ranking("L-p0", MONTH)).toBe(1);
    expect(repo.check("L-p0", MONTH)).toEqual({ checkedAt: NOW, snapshotId: null });
    expect(run.status).toBe("succeeded");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatch(/^Could not save the check for "a" \(2826\).*snapshot write failed$/);
  });

  it("a failed saved-check lookup falls back to a paid check instead of blanking the phrase", async () => {
    const repo = new FakeRepo();
    repo.addLead("L", ["a"]);
    repo.findFreshSnapshot = async () => {
      throw new Error("connection reset");
    };
    const serp = scriptedSerp(() => serpWithOrganic(["lead.co.uk"]));
    const warn = vi.fn();

    const run = await pullOnce(repo, serp, "L", {}, { warn });

    expect(serp.calls).toEqual(["a"]);
    expect(repo.ranking("L-p0", MONTH)).toBe(1);
    expect(run).toMatchObject({ status: "succeeded", phrases_failed: 0 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatch(/^Saved check lookup failed for "a" \(2826\).*connection reset$/);
  });
});

describe("a phrase listed twice in one lead", () => {
  it("is checked once and both rows get the position", async () => {
    const repo = new FakeRepo();
    repo.addLead("A", ["scaffolding hire", "Scaffolding  Hire"]);
    const serp = scriptedSerp(() => serpWithOrganic(["x.co.uk", "lead.co.uk"]));

    const run = await pullOnce(repo, serp, "A");

    expect(serp.calls).toEqual(["scaffolding hire"]);
    expect([repo.ranking("A-p0", MONTH), repo.ranking("A-p1", MONTH)]).toEqual([2, 2]);
    expect(repo.snapshots).toHaveLength(1);
    expect(run).toMatchObject({ status: "succeeded", phrases_done: 2, phrases_failed: 0 });
  });

  it("shares the in-flight call, before any check is saved", async () => {
    const repo = new FakeRepo();
    repo.addLead("A", ["x", "x"]);
    const calls: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const serp = {
      mode: "live" as const,
      reusable: true,
      async fetchSerp(task: { keyword: string }) {
        calls.push(task.keyword);
        await held;
        return serpWithOrganic(["lead.co.uk"]);
      },
    };

    const pull = await startLeadPull({ repo, serp, limit: unlimited, inFlight: new Set<string>(), now }, "A");
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 10));
    release();
    await pull.done;

    expect(calls).toEqual(["x"]);
    expect([repo.ranking("A-p0", MONTH), repo.ranking("A-p1", MONTH)]).toEqual([1, 1]);
  });

  it("is checked once even when the saved-check lookup fails", async () => {
    const repo = new FakeRepo();
    repo.addLead("A", ["scaffolding hire", "scaffolding hire"]);
    repo.findFreshSnapshot = async () => {
      throw new Error("connection reset");
    };
    const serp = scriptedSerp(() => serpWithOrganic(["lead.co.uk"]));

    const pull = await startLeadPull({ repo, serp, limit: unlimited, inFlight: new Set<string>(), now, warn: () => {} }, "A");
    await pull.done;

    expect(serp.calls).toEqual(["scaffolding hire"]);
    expect([repo.ranking("A-p0", MONTH), repo.ranking("A-p1", MONTH)]).toEqual([1, 1]);
  });

  it("is checked per row by a non-reusable (mock) client", async () => {
    const repo = new FakeRepo();
    repo.addLead("A", ["scaffolding hire", "scaffolding hire"]);
    const serp = scriptedSerp(() => serpWithOrganic(["lead.co.uk"]), false);

    await pullOnce(repo, serp, "A");

    expect(serp.calls).toHaveLength(2);
  });
});

describe("separate pulls", () => {
  it("do not share in-memory checks - only saved ones", async () => {
    const repo = new FakeRepo();
    repo.addLead("A", ["x"]);
    const serp = scriptedSerp(() => serpTaskError(50000));

    await pullOnce(repo, serp, "A");
    await pullOnce(repo, serp, "A");

    expect(serp.calls).toEqual(["x", "x"]);
  });

  it("of two leads run under one shared concurrency limit", async () => {
    const repo = new FakeRepo();
    for (const id of ["A", "B"]) repo.addLead(id, [`${id}1`, `${id}2`]);
    let inFlight = 0;
    let peak = 0;
    const serp = {
      mode: "mock" as const,
      reusable: true,
      async fetchSerp() {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return serpWithOrganic(["lead.co.uk"]);
      },
    };
    const deps = { repo, serp, limit: pLimit(2), inFlight: new Set<string>(), now };

    const pulls = await Promise.all(["A", "B"].map((id) => startLeadPull(deps, id)));
    await Promise.all(pulls.map((p) => p.done));

    expect(peak).toBe(2);
    expect(repo.runs.every((r) => r.status === "succeeded")).toBe(true);
  });
});
