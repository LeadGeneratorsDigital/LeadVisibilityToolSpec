import { beforeEach, describe, expect, it, vi } from "vitest";

/** Stand-in for the Supabase client that, like PostgREST, never returns more than `max_rows` rows per request. */
const fake = vi.hoisted(() => {
  const MAX_ROWS = 1000;
  const state = { tables: {} as Record<string, unknown[]>, calls: [] as string[], rpcArgs: undefined as unknown };
  const builder = (table: string) => {
    const q = { from: 0, to: Number.POSITIVE_INFINITY, limit: Number.POSITIVE_INFINITY, count: false };
    const b = {
      select: (_columns?: string, options?: { count?: string }) => ((q.count = Boolean(options?.count)), b),
      in: () => b,
      eq: () => b,
      gte: () => b,
      order: () => b,
      limit: (n: number) => ((q.limit = n), b),
      range: (from: number, to: number) => ((q.from = from), (q.to = to), b),
      delete: () => (state.calls.push(`delete ${table}`), b),
      insert: () => (state.calls.push(`insert ${table}`), b),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
        const rows = state.tables[table] ?? [];
        const end = Math.min(q.to + 1, q.from + q.limit, q.from + MAX_ROWS);
        return Promise.resolve({ data: rows.slice(q.from, end), error: null, count: q.count ? rows.length : null }).then(resolve, reject);
      },
    };
    return b;
  };
  const supabase = {
    from: (table: string) => builder(table),
    rpc: (fn: string, args: unknown) => {
      state.calls.push(`rpc ${fn}`);
      state.rpcArgs = args;
      return Promise.resolve({ data: null, error: null });
    },
  };
  return { state, supabase };
});

vi.mock("./supabase", () => ({ supabase: fake.supabase }));

const { data } = await import("./data");

beforeEach(() => {
  fake.state.tables = {};
  fake.state.calls = [];
  fake.state.rpcArgs = undefined;
});

describe("reads past the PostgREST row cap", () => {
  it("a lead's ranking history returns every row, not the first 1000", async () => {
    fake.state.tables.rankings = Array.from({ length: 2500 }, (_, i) => ({ phrase_id: `p${i % 50}`, month: "2026-10-01", position: 1 }));
    expect(await data.rankings(["p0"])).toHaveLength(2500);
  });

  it("the dashboard's ranking cells return every row", async () => {
    fake.state.tables.rankings = Array.from({ length: 2500 }, (_, i) => ({ month: "2026-10-01", position: 1, phrases: { lead_id: `L${i % 100}` } }));
    expect(await data.leadRankingCells("2026-08-01")).toHaveLength(2500);
  });

  it("the latest pull run is returned for every lead, however many leads there are", async () => {
    const runs = Array.from({ length: 250 }, (_, i) => ({ id: `r${i}`, lead_id: `L${i}`, status: "succeeded", started_at: "2026-10-08T10:00:00Z" }));
    fake.state.tables.ranking_pull_runs = runs;
    fake.state.tables.latest_pull_runs = runs;
    expect(await data.latestRuns()).toHaveLength(250);
  });
});

describe("saveContacts", () => {
  it("replaces the contacts in one database call, so a failed insert cannot leave the lead with none", async () => {
    await data.saveContacts("L1", [
      { name: " Sarah ", job_title: " ", email: " s@x.co.uk ", sort_order: 9 },
      { name: "Tom", job_title: "Ops", email: "t@x.co.uk", sort_order: 3 },
    ]);
    expect(fake.state.calls).toEqual(["rpc save_contacts"]);
    expect(fake.state.rpcArgs).toEqual({
      p_lead_id: "L1",
      p_contacts: [
        { name: "Sarah", job_title: null, email: "s@x.co.uk" },
        { name: "Tom", job_title: "Ops", email: "t@x.co.uk" },
      ],
    });
  });
});
