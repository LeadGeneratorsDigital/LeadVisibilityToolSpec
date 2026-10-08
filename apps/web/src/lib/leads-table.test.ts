import { describe, expect, it } from "vitest";
import type { LeadRow } from "./leads-table";
import { countByStatus, filterByStatus, filterLeads, joinEmails, latestRunByLead, sortLeads, withLocationLabels } from "./leads-table";
import type { Lead, PullRun } from "./types";

describe("status filter", () => {
  const rows = [{ status: "active" as const }, { status: "paused" as const }, { status: "active" as const }];

  it("'all' keeps every row; a status keeps only matching rows", () => {
    expect(filterByStatus(rows, "all")).toHaveLength(3);
    expect(filterByStatus(rows, "active")).toEqual([rows[0], rows[2]]);
    expect(filterByStatus(rows, "converted")).toEqual([]);
  });

  it("counts each status plus the total", () => {
    expect(countByStatus(rows)).toEqual({ all: 3, active: 2, paused: 1, converted: 0 });
  });
});

function lead(overrides: Partial<Lead>): Lead {
  return {
    id: overrides.business_name ?? "x",
    business_name: "x",
    industry: null,
    location_code: null,
    website_domain: null,
    status: "active",
    brief: "",
    date_added: "2026-01-01",
    next_email_due: null,
    last_ranking_pull: null,
    ...overrides,
  };
}

const rows: LeadRow[] = withLocationLabels(
  [
    lead({ business_name: "beta Roofing", next_email_due: "2026-10-20", location_code: "LON", status: "paused" }),
    lead({ business_name: "Alpha Clean", next_email_due: null, location_code: "UK", status: "converted" }),
    lead({ business_name: "Gamma Scaffolding", next_email_due: "2026-10-09", location_code: null, status: "active" }),
  ],
  [
    { code: "LON", label: "London", data4seo_location_code: 1 },
    { code: "UK", label: "United Kingdom", data4seo_location_code: 2 },
  ],
);

const names = (list: LeadRow[]) => list.map((r) => r.business_name);

describe("sortLeads", () => {
  it("sorts names case-insensitively in both directions", () => {
    expect(names(sortLeads(rows, "business_name", "asc"))).toEqual(["Alpha Clean", "beta Roofing", "Gamma Scaffolding"]);
    expect(names(sortLeads(rows, "business_name", "desc"))).toEqual(["Gamma Scaffolding", "beta Roofing", "Alpha Clean"]);
  });

  it("keeps empty dates last in both directions", () => {
    expect(names(sortLeads(rows, "next_email_due", "asc"))).toEqual(["Gamma Scaffolding", "beta Roofing", "Alpha Clean"]);
    expect(names(sortLeads(rows, "next_email_due", "desc"))).toEqual(["beta Roofing", "Gamma Scaffolding", "Alpha Clean"]);
  });

  it("sorts location by label, not code", () => {
    expect(names(sortLeads(rows, "location", "asc"))).toEqual(["beta Roofing", "Alpha Clean", "Gamma Scaffolding"]);
  });

  it("sorts status by its display label", () => {
    expect(names(sortLeads(rows, "status", "asc"))).toEqual(["Gamma Scaffolding", "Alpha Clean", "beta Roofing"]);
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
    expect(filterLeads(rows, "London")).toEqual([]);
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

  it("shows a run still 'running' long after it started as interrupted, so the pull buttons unlock", () => {
    const started = "2026-10-08T10:00:00Z";
    const at = (minutes: number) => new Date(Date.parse(started) + minutes * 60_000);
    expect(latestRunByLead([run("A", started, "running")], at(59)).get("A")!.status).toBe("running");
    expect(latestRunByLead([run("A", started, "running")], at(61)).get("A")).toMatchObject({ status: "failed", error: "Pull was interrupted - pull again" });
  });
});

describe("joinEmails", () => {
  it("comma-separates, trims, and drops blanks and case-insensitive repeats", () => {
    expect(joinEmails([" a@x.com", "", "B@x.com", "A@X.com "])).toBe("a@x.com, B@x.com");
  });
});
