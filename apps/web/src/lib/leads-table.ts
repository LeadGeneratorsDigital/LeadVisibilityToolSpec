import { INTERRUPTED_RUN_ERROR } from "@lvt/shared";
import type { Lead, LeadStatus, LocationCode, PullRun } from "./types";
import { STATUS_LABEL } from "./types";

export type SortKey = "business_name" | "industry" | "location" | "next_email_due" | "last_ranking_pull" | "status";
export type SortDirection = "asc" | "desc";

export interface LeadRow extends Lead {
  locationLabel: string;
}

export function withLocationLabels(leads: Lead[], locations: LocationCode[]): LeadRow[] {
  const labels = new Map(locations.map((l) => [l.code, l.label]));
  return leads.map((lead) => ({ ...lead, locationLabel: lead.location_code ? (labels.get(lead.location_code) ?? lead.location_code) : "" }));
}

function sortValue(row: LeadRow, key: SortKey): string | null {
  switch (key) {
    case "location":
      return row.locationLabel || null;
    case "status":
      return STATUS_LABEL[row.status];
    default:
      return row[key] || null;
  }
}

/** Empty values always sort last, whichever direction is chosen. */
export function sortLeads(rows: LeadRow[], key: SortKey, direction: SortDirection): LeadRow[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = sortValue(a, key);
    const bv = sortValue(b, key);
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return sign * av.localeCompare(bv, "en-GB", { sensitivity: "base", numeric: true });
  });
}

/** Spec section 4.1: instant client-side filter on lead name. */
export function filterLeads(rows: LeadRow[], query: string): LeadRow[] {
  const q = query.trim().toLowerCase();
  return q ? rows.filter((row) => row.business_name.toLowerCase().includes(q)) : rows;
}

export type StatusFilter = LeadStatus | "all";

export function filterByStatus<T extends { status: LeadStatus }>(rows: T[], status: StatusFilter): T[] {
  return status === "all" ? rows : rows.filter((row) => row.status === status);
}

export function countByStatus(rows: Array<{ status: LeadStatus }>): Record<StatusFilter, number> {
  const counts: Record<StatusFilter, number> = { all: rows.length, active: 0, paused: 0, converted: 0 };
  for (const row of rows) counts[row.status]++;
  return counts;
}

/**
 * The API marks orphaned runs failed on restart and on the lead's next pull. This is the fallback that
 * unlocks the pull buttons if neither happens; a run still alive past it gets a 409 from the API, not a duplicate.
 */
export const RUN_PRESUMED_INTERRUPTED_MS = 60 * 60 * 1000;

/** Most recent run per lead, from runs in any order. */
export function latestRunByLead(runs: PullRun[], now = new Date()): Map<string, PullRun> {
  const latest = new Map<string, PullRun>();
  for (const run of runs) {
    const current = latest.get(run.lead_id);
    if (!current || run.started_at > current.started_at) latest.set(run.lead_id, run);
  }
  for (const [leadId, run] of latest) {
    if (run.status === "running" && now.getTime() - Date.parse(run.started_at) > RUN_PRESUMED_INTERRUPTED_MS) {
      latest.set(leadId, { ...run, status: "failed", error: INTERRUPTED_RUN_ERROR });
    }
  }
  return latest;
}

/** Spec section 4.2: comma-separated, ready to paste into Gmail. Blank and repeated addresses are dropped. */
export function joinEmails(emails: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of emails) {
    const email = raw.trim();
    const key = email.toLowerCase();
    if (email && !seen.has(key)) {
      seen.add(key);
      out.push(email);
    }
  }
  return out.join(", ");
}
