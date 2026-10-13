import { beforeEach, describe, expect, it, vi } from "vitest";

/** Stand-in for the Supabase client that, like PostgREST, never returns more than `max_rows` rows per request. */
const fake = vi.hoisted(() => {
  const MAX_ROWS = 1000;
  const state = {
    tables: {} as Record<string, unknown[]>,
    calls: [] as string[],
    filters: [] as unknown[][],
    updates: [] as unknown[],
    rpcArgs: undefined as unknown,
    rpcResult: { data: null, error: null } as { data: unknown; error: { message: string } | null },
  };
  const builder = (table: string) => {
    const q = { from: 0, to: Number.POSITIVE_INFINITY, limit: Number.POSITIVE_INFINITY, count: false };
    const b = {
      select: (columns?: string, options?: { count?: string }) => (state.filters.push([table, "select", columns]), (q.count = Boolean(options?.count)), b),
      in: () => b,
      eq: (...args: unknown[]) => (state.filters.push([table, "eq", ...args]), b),
      is: (...args: unknown[]) => (state.filters.push([table, "is", ...args]), b),
      not: (...args: unknown[]) => (state.filters.push([table, "not", ...args]), b),
      gte: () => b,
      update: (row: unknown) => (state.calls.push(`update ${table}`), state.updates.push(row), b),
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
      return Promise.resolve(state.rpcResult);
    },
  };
  return { state, supabase };
});

vi.mock("./supabase", () => ({ supabase: fake.supabase }));

const { data } = await import("./data");

beforeEach(() => {
  fake.state.tables = {};
  fake.state.calls = [];
  fake.state.filters = [];
  fake.state.updates = [];
  fake.state.rpcArgs = undefined;
  fake.state.rpcResult = { data: null, error: null };
});

describe("CSV import", () => {
  it("reads every saved contact email with its lead's name, past the row cap", async () => {
    fake.state.tables.contacts = Array.from({ length: 1500 }, (_, i) => ({ email: `p${i}@a.co`, leads: { business_name: `Lead ${i}` } }));
    const emails = await data.contactEmails();
    expect(emails).toHaveLength(1500);
    expect(emails[1499]).toEqual({ email: "p1499@a.co", lead_name: "Lead 1499" });
    expect(fake.state.filters).toContainEqual(["contacts", "select", "email, leads!inner(business_name)"]);
  });

  it("sends the whole import as one import_leads call and returns the created count", async () => {
    const leads = [{ business_name: "Acme", website_domain: null, industry: null, location_code: null, status: "active" as const, next_email_due: null, contacts: [] }];
    fake.state.rpcResult = { data: 1, error: null };
    expect(await data.importLeads(leads)).toBe(1);
    expect(fake.state.calls).toEqual(["rpc import_leads"]);
    expect(fake.state.rpcArgs).toEqual({ p_leads: leads });
  });

  it("surfaces the database error when the import is rolled back", async () => {
    fake.state.rpcResult = { data: null, error: { message: "violates check constraint" } };
    await expect(data.importLeads([])).rejects.toThrow("violates check constraint");
  });
});

describe("archived phrases", () => {
  it("the phrase list hides archived phrases", async () => {
    fake.state.tables.phrases = [];
    await data.phrases("L1");
    expect(fake.state.filters).toContainEqual(["phrases", "is", "archived_at", null]);
  });

  it("dashboard ranking cells leave out archived phrases", async () => {
    fake.state.tables.rankings = [];
    await data.leadRankingCells("2026-08-01");
    expect(fake.state.filters).toContainEqual(["rankings", "is", "phrases.archived_at", null]);
  });

  it("removing a phrase archives it and never deletes it", async () => {
    fake.state.tables.phrases = [{ id: "p1" }];
    await data.archivePhrase("p1");
    expect(fake.state.calls).toEqual(["update phrases"]);
    expect(fake.state.updates[0]).toEqual({ archived_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) });
    expect(fake.state.filters).toContainEqual(["phrases", "eq", "id", "p1"]);
  });

  it("re-adding an archived phrase (any case or spacing) restores it into the chosen group", async () => {
    fake.state.tables.phrases = [{ id: "p9", phrase_text: "Scaffolding  Hire" }];
    expect(await data.addPhrase("L1", "g2", "scaffolding hire", 4)).toBe("restored");
    expect(fake.state.calls).toEqual(["update phrases"]);
    expect(fake.state.updates[0]).toEqual({ archived_at: null, buyer_group_id: "g2", sort_order: 4 });
    expect(fake.state.filters).toContainEqual(["phrases", "not", "archived_at", "is", null]);
    expect(fake.state.filters).toContainEqual(["phrases", "eq", "id", "p9"]);
  });

  it("a phrase with no archived match is inserted", async () => {
    fake.state.tables.phrases = [{ id: "p9", phrase_text: "scaffolding hire leeds" }];
    expect(await data.addPhrase("L1", null, "scaffolding hire", 1)).toBe("added");
    expect(fake.state.calls).toEqual(["insert phrases"]);
  });
});

describe("rankings", () => {
  it("reads the check time with each position", async () => {
    fake.state.tables.rankings = [{ phrase_id: "p0", month: "2026-10-01", position: 3, checked_at: "2026-10-05T09:00:00+00:00" }];
    expect(await data.rankings(["p0"])).toEqual([{ phrase_id: "p0", month: "2026-10-01", position: 3, checked_at: "2026-10-05T09:00:00+00:00" }]);
    expect(fake.state.filters).toContainEqual(["rankings", "select", "phrase_id, month, position, checked_at"]);
  });
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
