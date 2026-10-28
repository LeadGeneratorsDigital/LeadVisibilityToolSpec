import { INTERRUPTED_RUN_ERROR } from "@lvt/shared";
import { describe, expect, it } from "vitest";
import type { LeadRow } from "./leads-table";
import { countByStatus, filterByStatus, filterLeads, isEmail, joinEmails, latestRunByLead, sortLeads, withLocationLabels } from "./leads-table";
import type { Lead, PullRun } from "./types";

describe("status filter", () => {
  const rows = [{ status: "lead" as const }, { status: "client" as const }, { status: "lead" as const }];

  it("'all' keeps every row; a status keeps only matching rows", () => {
    expect(filterByStatus(rows, "all")).toHaveLength(3);
    expect(filterByStatus(rows, "lead")).toEqual([rows[0], rows[2]]);
    expect(filterByStatus([rows[0]!], "client")).toEqual([]);
  });

  it("counts each status plus the total", () => {
    expect(countByStatus(rows)).toEqual({ all: 3, lead: 2, client: 1 });
  });
});

function lead(overrides: Partial<Lead>): Lead {
  return {
    id: overrides.business_name ?? "x",
    business_name: "x",
    industry: null,
    location_code: null,
    website_domain: null,
    status: "lead",
    date_added: "2026-01-01",
    last_ranking_pull: null,
    ...overrides,
  };
}

const rows: LeadRow[] = withLocationLabels(
  [
    lead({ business_name: "beta Roofing", last_ranking_pull: "2026-10-20T09:00:00Z", location_code: "ZA", status: "lead" }),
    lead({ business_name: "Alpha Clean", last_ranking_pull: null, location_code: "UK", status: "client" }),
    lead({ business_name: "Gamma Scaffolding", last_ranking_pull: "2026-10-09T09:00:00Z", location_code: null, status: "lead" }),
  ],
  [
    { code: "ZA", label: "South Africa", data4seo_location_code: 2710 },
    { code: "UK", label: "United Kingdom", data4seo_location_code: 2826 },
  ],
);

const names = (list: LeadRow[]) => list.map((r) => r.business_name);

describe("sortLeads", () => {
  it("sorts names case-insensitively in both directions", () => {
    expect(names(sortLeads(rows, "business_name", "asc"))).toEqual(["Alpha Clean", "beta Roofing", "Gamma Scaffolding"]);
    expect(names(sortLeads(rows, "business_name", "desc"))).toEqual(["Gamma Scaffolding", "beta Roofing", "Alpha Clean"]);
  });

  it("keeps empty dates last in both directions", () => {
    expect(names(sortLeads(rows, "last_ranking_pull", "asc"))).toEqual(["Gamma Scaffolding", "beta Roofing", "Alpha Clean"]);
    expect(names(sortLeads(rows, "last_ranking_pull", "desc"))).toEqual(["beta Roofing", "Gamma Scaffolding", "Alpha Clean"]);
  });

  it("sorts location by label, not code", () => {
    expect(names(sortLeads(rows, "location", "asc"))).toEqual(["beta Roofing", "Alpha Clean", "Gamma Scaffolding"]);
  });

  it("sorts status by its display label", () => {
    expect(names(sortLeads(rows, "status", "asc"))).toEqual(["Alpha Clean", "beta Roofing", "Gamma Scaffolding"]);
  });

  it("does not mutate the input", () => {
    const before = names(rows);
    sortLeads(rows, "business_name", "desc");
    expect(names(rows)).toEqual(before);
  });
});

describe("filterLeads", () => {
  it("matches a case-insensitive substring of the name only", () => {
    expect(names(filterLeads(rows, "  ROOF "))).toEqual(["beta Roofing"]);
    expect(filterLeads(rows, "Africa")).toEqual([]);
  });

  it("blank query returns everything", () => {
    expect(filterLeads(rows, "   ")).toHaveLength(3);
  });
});

describe("withLocationLabels", () => {
  it("falls back to the raw code when the code is unknown", () => {
    expect(withLocationLabels([lead({ location_code: "MAN" })], [])[0]!.locationLabel).toBe("MAN");
  });
});

describe("latestRunByLead", () => {
  const run = (lead_id: string, started_at: string, status: PullRun["status"]): PullRun => ({
    id: `${lead_id}-${started_at}`,
    lead_id,
    status,
    phrases_total: 1,
    phrases_done: 0,
    phrases_failed: 0,
    error: null,
    started_at,
    finished_at: null,
  });

  it("picks the newest run per lead regardless of input order", () => {
    const latest = latestRunByLead([
      run("A", "2026-10-01T10:00:00Z", "failed"),
      run("A", "2026-10-08T10:00:00Z", "running"),
      run("A", "2026-10-05T10:00:00Z", "succeeded"),
      run("B", "2026-10-02T10:00:00Z", "succeeded"),
    ], new Date("2026-10-08T10:05:00Z"));
    expect(latest.get("A")!.status).toBe("running");
    expect(latest.get("B")!.status).toBe("succeeded");
  });

  it("shows a run still 'running' long after it started as interrupted, so the Update rankings button unlocks", () => {
    const started = "2026-10-08T10:00:00Z";
    const at = (minutes: number) => new Date(Date.parse(started) + minutes * 60_000);
    expect(latestRunByLead([run("A", started, "running")], at(59)).get("A")!.status).toBe("running");
    expect(latestRunByLead([run("A", started, "running")], at(61)).get("A")).toMatchObject({ status: "failed", error: INTERRUPTED_RUN_ERROR });
  });
});

describe("isEmail", () => {
  it.each(["a@x.co", " a.b@x.co.uk ", "a+tag@sub.x.com"])("%j is an email", (value) => {
    expect(isEmail(value)).toBe(true);
  });

  it.each(["", "a@x", "@x.co", "a@.co", "a x@y.co", "ax.co", "a@x.", "a@x co.uk", "a@x.co b"])("%j is not an email", (value) => {
    expect(isEmail(value)).toBe(false);
  });
});

describe("joinEmails", () => {
  it("semicolon-separates for Outlook, trims, and drops blanks and case-insensitive repeats", () => {
    expect(joinEmails([" a@x.com", "", "B@x.com", "A@X.com "])).toBe("a@x.com; B@x.com");
  });
});
