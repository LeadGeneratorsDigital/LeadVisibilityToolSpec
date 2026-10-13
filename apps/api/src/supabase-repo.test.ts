import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { PullConflictError } from "./pull-service";
import { createSupabasePullRepo } from "./supabase-repo";

type Result = { data: unknown; error: { message: string; code?: string } | null };

/** Records every builder call per query; each query resolves to the next queued result. */
function fakeDb(results: Result[]) {
  const queries: Array<{ table: string; calls: Array<[string, ...unknown[]]> }> = [];
  const db = {
    from(table: string) {
      const query = { table, calls: [] as Array<[string, ...unknown[]]> };
      queries.push(query);
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "insert", "update", "upsert", "eq", "is", "not", "in", "gte", "order", "limit", "maybeSingle", "single"]) {
        builder[method] = (...args: unknown[]) => (query.calls.push([method, ...args]), builder);
      }
      builder.then = (resolve: (r: Result) => unknown) => Promise.resolve(results.shift() ?? { data: null, error: null }).then(resolve);
      return builder;
    },
  };
  return { db: db as unknown as SupabaseClient, queries };
}

describe("createSupabasePullRepo", () => {
  it("listPhrases leaves out headings and archived phrases", async () => {
    const { db, queries } = fakeDb([{ data: [], error: null }]);
    await createSupabasePullRepo(db).listPhrases("L");
    expect(queries[0]!.calls).toEqual(expect.arrayContaining([["eq", "lead_id", "L"], ["eq", "is_heading", false], ["is", "archived_at", null]]));
  });

  it("listRankedPhraseIds counts only real positions for the month", async () => {
    const { db, queries } = fakeDb([{ data: [{ phrase_id: "p1" }], error: null }]);
    const ranked = await createSupabasePullRepo(db).listRankedPhraseIds(["p1", "p2"], "2026-10-01");
    expect(ranked).toEqual(new Set(["p1"]));
    expect(queries[0]!.calls).toEqual(expect.arrayContaining([["in", "phrase_id", ["p1", "p2"]], ["eq", "month", "2026-10-01"], ["not", "position", "is", null]]));
  });

  it("listRankedPhraseIds with no phrases does not query", async () => {
    const { db, queries } = fakeDb([]);
    expect(await createSupabasePullRepo(db).listRankedPhraseIds([], "2026-10-01")).toEqual(new Set());
    expect(queries).toEqual([]);
  });

  it("findFreshSnapshot asks for the newest check of this keyword + location since the cut-off", async () => {
    const since = new Date("2026-10-01T10:00:00Z");
    const items = [{ rank: 1, domain: "a.co.uk", url: "https://a.co.uk/", title: "" }];
    const { db, queries } = fakeDb([{ data: { id: "s1", fetched_at: "2026-10-05T09:00:00+00:00", items }, error: null }]);

    const saved = await createSupabasePullRepo(db).findFreshSnapshot("scaffolding hire", 2826, since);

    expect(saved).toEqual({ id: "s1", fetched_at: new Date("2026-10-05T09:00:00Z"), items });
    expect(queries[0]!.table).toBe("serp_snapshots");
    expect(queries[0]!.calls).toEqual(
      expect.arrayContaining([
        ["eq", "keyword_key", "scaffolding hire"],
        ["eq", "location_code", 2826],
        ["gte", "fetched_at", since.toISOString()],
        ["order", "fetched_at", { ascending: false }],
        ["limit", 1],
      ]),
    );
  });

  it("saveRanking writes the check time and snapshot link", async () => {
    const { db, queries } = fakeDb([{ data: null, error: null }]);
    await createSupabasePullRepo(db).saveRanking("p1", "2026-10-01", 4, { checkedAt: new Date("2026-10-05T09:00:00Z"), snapshotId: "s1" });
    expect(queries[0]!.calls[0]).toEqual([
      "upsert",
      { phrase_id: "p1", month: "2026-10-01", position: 4, checked_at: "2026-10-05T09:00:00.000Z", snapshot_id: "s1" },
      { onConflict: "phrase_id,month" },
    ]);
  });

  it("createRun turns the one-running-run unique violation into a PullConflictError", async () => {
    const { db } = fakeDb([{ data: null, error: { message: "duplicate key", code: "23505" } }]);
    await expect(createSupabasePullRepo(db).createRun("L", 3)).rejects.toBeInstanceOf(PullConflictError);
  });

  it("createRun reports any other database error as a plain error", async () => {
    const { db } = fakeDb([{ data: null, error: { message: "connection reset", code: "08006" } }]);
    const err = await createSupabasePullRepo(db).createRun("L", 3).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(PullConflictError);
    expect((err as Error).message).toBe("Create pull run: connection reset");
  });
});
