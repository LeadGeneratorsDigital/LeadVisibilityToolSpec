import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => {
  const state = { tables: {} as Record<string, unknown[]>, rpc: [] as Array<[string, unknown]> };
  const builder = (table: string) => {
    const q = { from: 0, to: Number.POSITIVE_INFINITY };
    const b = {
      select: () => b,
      order: () => b,
      range: (from: number, to: number) => ((q.from = from), (q.to = to), b),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: (state.tables[table] ?? []).slice(q.from, q.to + 1), error: null }).then(resolve),
    };
    return b;
  };
  const supabase = {
    from: builder,
    rpc: (fn: string, args: unknown) => (state.rpc.push([fn, args]), Promise.resolve({ data: 1, error: null })),
  };
  return { state, supabase };
});

vi.mock("./supabase", () => ({ supabase: fake.supabase }));

const { planImportFile, runImport } = await import("./import-file");

const HEAD = "Business name,Location,Contact name,Email";

beforeEach(() => {
  fake.state.tables = {
    leads: [{ id: "L1", business_name: "Existing Ltd" }],
    contacts: [{ email: "sam@old.co", leads: { business_name: "Old Co" } }],
    location_codes: [{ code: "ZA", label: "South Africa", data4seo_location_code: 2710 }],
  };
  fake.state.rpc = [];
});

describe("planImportFile", () => {
  it("checks the file against the saved leads, contact emails and locations it reads at that moment", async () => {
    const file = new Blob([`${HEAD}\nExisting Ltd,,Ann,ann@a.co\nNew Co,South Africa,Sam,SAM@old.co\nNew Co,,Bo,bo@a.co\n`]);
    const plan = await planImportFile(file);
    expect(plan.rows.map((r) => [r.line, r.status, r.message])).toEqual([
      [2, "duplicate", "Lead already exists - add new contacts on its page"],
      [3, "duplicate", "Email already saved for Old Co - contact skipped"],
      [4, "ready", null],
    ]);
    expect(plan.leads).toEqual([
      { business_name: "New Co", website_domain: null, industry: null, location_code: "ZA", status: "lead", contacts: [{ name: "Bo", job_title: null, email: "bo@a.co" }] },
    ]);
  });

  it("decodes an Excel Windows-1252 file", async () => {
    const file = new Blob([new Uint8Array([...Buffer.from(`${HEAD}\nCaf`), 0xe9, ...Buffer.from(" Ltd,,,\n")])]);
    expect((await planImportFile(file)).leads.map((l) => l.business_name)).toEqual(["Café Ltd"]);
  });
});

describe("runImport", () => {
  it("sends the plan's leads and marks the lead and contact queries stale", async () => {
    const plan = await planImportFile(new Blob([`${HEAD}\nNew Co,,Bo,bo@a.co\n`]));
    const client = new QueryClient();
    for (const key of [["leads"], ["contacts", "emails"], ["contacts", "L1"], ["rankings"]]) client.setQueryData(key, []);

    expect(await runImport(plan, client)).toBe(1);
    expect(fake.state.rpc).toEqual([["import_leads", { p_leads: plan.leads }]]);
    const stale = (key: string[]) => client.getQueryState(key)!.isInvalidated;
    expect([stale(["leads"]), stale(["contacts", "emails"]), stale(["contacts", "L1"]), stale(["rankings"])]).toEqual([true, true, true, false]);
  });
});
