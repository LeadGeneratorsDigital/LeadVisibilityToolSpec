import type { FrtLead } from "./parse-workbook";

/** The inserts the FRT import makes; each throws on a failed write. */
export interface FrtStore {
  insertLead(row: { business_name: string; website_domain: string | null; location_code: string; status: "lead"; last_ranking_pull: string | null }): Promise<string>;
  insertContacts(rows: Array<{ lead_id: string; name: string; email: string; sort_order: number }>): Promise<void>;
  insertHeading(row: { lead_id: string; name: string; sort_order: number }): Promise<string>;
  insertPhrases(rows: Array<{ lead_id: string; buyer_group_id: string | null; phrase_text: string; sort_order: number }>): Promise<Array<{ id: string; sort_order: number }>>;
  insertRankings(rows: Array<{ phrase_id: string; month: string; position: number }>): Promise<void>;
  /** Contacts, headings, phrases and rankings go with it (ON DELETE CASCADE). */
  deleteLead(id: string): Promise<void>;
}

export const RANKING_BATCH = 500;

/** Consecutive failed leads after which a run stops: a dead connection or bad key fails every lead. */
export const MAX_CONSECUTIVE_FAILURES = 3;

export type Outcome = "would import" | "imported" | "already exists" | "failed" | "not attempted";

export interface LeadResult {
  sheet: string;
  business_name: string;
  outcome: Outcome;
  error?: string;
}

/** Writes one lead whole; if any step fails the lead is removed again and the error rethrown. */
export async function writeLead(store: FrtStore, lead: FrtLead): Promise<void> {
  // Imported history has no real check time; the 1st of its latest month keeps "Last ranking update" sortable.
  const lastPull = lead.latest_month ? `${lead.latest_month}T12:00:00Z` : null;
  const id = await store.insertLead({ business_name: lead.business_name, website_domain: lead.website_domain, location_code: lead.location_code, status: "lead", last_ranking_pull: lastPull });
  try {
    if (lead.contacts.length > 0) await store.insertContacts(lead.contacts.map((c, i) => ({ lead_id: id, name: c.name, email: c.email, sort_order: i + 1 })));
    let order = 0;
    for (const [groupIndex, group] of lead.groups.entries()) {
      const groupId = group.name === null ? null : await store.insertHeading({ lead_id: id, name: group.name, sort_order: groupIndex + 1 });
      const firstOrder = order + 1;
      const rows = await store.insertPhrases(group.phrases.map((p) => ({ lead_id: id, buyer_group_id: groupId, phrase_text: p.text, sort_order: ++order })));
      const idByOrder = new Map(rows.map((r) => [r.sort_order, r.id]));
      const rankings = group.phrases.flatMap((p, i) => {
        const phraseId = idByOrder.get(firstOrder + i);
        if (!phraseId) throw new Error(`Insert phrases: "${p.text}" came back without an id`);
        return p.rankings.map((r) => ({ phrase_id: phraseId, month: r.month, position: r.position }));
      });
      for (let i = 0; i < rankings.length; i += RANKING_BATCH) await store.insertRankings(rankings.slice(i, i + RANKING_BATCH));
    }
  } catch (err) {
    try {
      await store.deleteLead(id);
    } catch (cleanup) {
      throw new Error(`${(err as Error).message} - and removing the half-written lead failed (${(cleanup as Error).message}); delete "${lead.business_name}" by hand`);
    }
    throw err;
  }
}

/**
 * Writes every "not attempted" lead in order, updating its result and calling `saved` after each,
 * and stops after MAX_CONSECUTIVE_FAILURES failures in a row. Returns whether it stopped early.
 */
export async function applyPlan(store: FrtStore, leads: FrtLead[], results: LeadResult[], saved: (result: LeadResult) => void): Promise<boolean> {
  let consecutiveFailures = 0;
  for (const result of results) {
    if (result.outcome !== "not attempted") continue;
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) return true;
    const lead = leads.find((l) => l.sheet === result.sheet)!;
    try {
      await writeLead(store, lead);
      result.outcome = "imported";
      consecutiveFailures = 0;
    } catch (err) {
      result.outcome = "failed";
      result.error = (err as Error).message;
      consecutiveFailures++;
    }
    saved(result);
  }
  return false;
}

/** 1 when any lead failed or was never attempted, so a partial run is never mistaken for a finished one. */
export function exitCode(results: LeadResult[]): 0 | 1 {
  return results.some((r) => r.outcome === "failed" || r.outcome === "not attempted") ? 1 : 0;
}
