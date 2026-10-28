import { keywordKey } from "@lvt/shared";
import type { LeadRankingCell } from "./insights";
import { supabase } from "./supabase";
import type { ExistingContact, ImportLead } from "./lead-import";
import { MAX_CONTACTS, type BuyerGroup, type Contact, type Lead, type LocationCode, type Phrase, type PullRun, type Ranking } from "./types";

function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  if (result.data === null) throw new Error("No data returned");
  return result.data;
}

export { MAX_CONTACTS };

const PAGE_SIZE = 1000;

/**
 * PostgREST silently truncates a response at `max_rows` (1000 on Supabase), so reads that can grow past
 * it page until an empty page. Stopping at a short page instead would truncate again if max_rows were lowered.
 */
async function selectAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (;;) {
    const batch = unwrap(await page(rows.length, rows.length + PAGE_SIZE - 1));
    if (batch.length === 0) return rows;
    rows.push(...batch);
  }
}

export const data = {
  async locations(): Promise<LocationCode[]> {
    return unwrap(await supabase.from("location_codes").select("*").order("label"));
  },

  async leads(): Promise<Lead[]> {
    return unwrap(await supabase.from("leads").select("*").order("business_name"));
  },

  async lead(id: string): Promise<Lead> {
    return unwrap(await supabase.from("leads").select("*").eq("id", id).single());
  },

  async createLead(fields: Partial<Lead> & { business_name: string }): Promise<Lead> {
    return unwrap(await supabase.from("leads").insert(fields).select("*").single());
  },

  async updateLead(id: string, fields: Partial<Lead>): Promise<Lead> {
    return unwrap(await supabase.from("leads").update(fields).eq("id", id).select("*").single());
  },

  async contacts(leadId: string): Promise<Contact[]> {
    return unwrap(await supabase.from("contacts").select("*").eq("lead_id", leadId).order("sort_order"));
  },

  /** Replaces the lead's contacts in one transaction (save_contacts); sort_order is renumbered 1..n from the given order. */
  async saveContacts(leadId: string, contacts: Contact[]): Promise<void> {
    if (contacts.length > MAX_CONTACTS) throw new Error(`A lead can have at most ${MAX_CONTACTS} contacts`);
    const rows = contacts.map((c) => ({ name: c.name.trim(), job_title: c.job_title?.trim() || null, email: c.email.trim() }));
    const { error } = await supabase.rpc("save_contacts", { p_lead_id: leadId, p_contacts: rows });
    if (error) throw new Error(error.message);
  },

  /** Every saved contact email with its lead's name, for the import duplicate check. */
  async contactEmails(): Promise<ExistingContact[]> {
    const rows = (await selectAll((from, to) => supabase.from("contacts").select("email, leads!inner(business_name)").order("id").range(from, to))) as unknown as Array<{
      email: string;
      leads: { business_name: string };
    }>;
    return rows.map((r) => ({ email: r.email, lead_name: r.leads.business_name }));
  },

  /** Creates the leads and their contacts in one transaction (import_leads): all of them or none. */
  async importLeads(leads: ImportLead[]): Promise<number> {
    const { data: count, error } = await supabase.rpc("import_leads", { p_leads: leads });
    if (error) throw new Error(error.message);
    return count as number;
  },

  async buyerGroups(leadId: string): Promise<BuyerGroup[]> {
    return unwrap(await supabase.from("buyer_groups").select("*").eq("lead_id", leadId).order("sort_order"));
  },

  /** Tracked phrases only; archived ones keep their history but are hidden. */
  async phrases(leadId: string): Promise<Phrase[]> {
    return unwrap(await supabase.from("phrases").select("*").eq("lead_id", leadId).is("archived_at", null).order("sort_order"));
  },

  async rankings(phraseIds: string[]): Promise<Ranking[]> {
    if (phraseIds.length === 0) return [];
    return selectAll((from, to) => supabase.from("rankings").select("phrase_id, month, position, checked_at").in("phrase_id", phraseIds).order("id").range(from, to));
  },

  /** Ranking cells for every lead since `sinceMonth`, tagged with the owning lead, for dashboard summaries. */
  async leadRankingCells(sinceMonth: string): Promise<LeadRankingCell[]> {
    const rows = (await selectAll((from, to) =>
      supabase
        .from("rankings")
        .select("month, position, phrases!inner(lead_id, is_heading)")
        .gte("month", sinceMonth)
        .eq("phrases.is_heading", false)
        .is("phrases.archived_at", null)
        .order("id")
        .range(from, to),
    )) as unknown as Array<{ month: string; position: number | null; phrases: { lead_id: string } }>;
    return rows.map((r) => ({ lead_id: r.phrases.lead_id, month: r.month, position: r.position }));
  },

  async addBuyerGroup(leadId: string, name: string, sortOrder: number): Promise<void> {
    unwrap(await supabase.from("buyer_groups").insert({ lead_id: leadId, name, sort_order: sortOrder }).select("id"));
  },

  async renameBuyerGroup(id: string, name: string): Promise<void> {
    unwrap(await supabase.from("buyer_groups").update({ name }).eq("id", id).select("id"));
  },

  /** Phrases in the group are kept and become ungrouped (FK is ON DELETE SET NULL). */
  async deleteBuyerGroup(id: string): Promise<void> {
    unwrap(await supabase.from("buyer_groups").delete().eq("id", id).select("id"));
  },

  /** Re-adding an archived phrase (same words, any case or spacing) restores it with its ranking history. */
  async addPhrase(leadId: string, buyerGroupId: string | null, text: string, sortOrder: number): Promise<"added" | "restored"> {
    const archived = unwrap(await supabase.from("phrases").select("id, phrase_text").eq("lead_id", leadId).not("archived_at", "is", null));
    const match = archived.find((p) => keywordKey(p.phrase_text) === keywordKey(text));
    if (match) {
      unwrap(await supabase.from("phrases").update({ archived_at: null, buyer_group_id: buyerGroupId, sort_order: sortOrder }).eq("id", match.id).select("id"));
      return "restored";
    }
    unwrap(await supabase.from("phrases").insert({ lead_id: leadId, buyer_group_id: buyerGroupId, phrase_text: text, sort_order: sortOrder }).select("id"));
    return "added";
  },

  /** Puts a phrase under another heading (null = none) at `sortOrder`; its rankings belong to the phrase, so they move too. */
  async movePhrase(id: string, buyerGroupId: string | null, sortOrder: number): Promise<void> {
    unwrap(await supabase.from("phrases").update({ buyer_group_id: buyerGroupId, sort_order: sortOrder }).eq("id", id).select("id"));
  },

  /** Stops tracking without deleting, so the phrase's ranking history is never lost. */
  async archivePhrase(id: string): Promise<void> {
    unwrap(await supabase.from("phrases").update({ archived_at: new Date().toISOString() }).eq("id", id).select("id"));
  },

  async swapSortOrder(table: "buyer_groups" | "phrases", a: { id: string; sort_order: number }, b: { id: string; sort_order: number }): Promise<void> {
    unwrap(await supabase.from(table).update({ sort_order: b.sort_order }).eq("id", a.id).select("id"));
    unwrap(await supabase.from(table).update({ sort_order: a.sort_order }).eq("id", b.id).select("id"));
  },

  /** Most recent run per lead, from the latest_pull_runs view. */
  async latestRuns(leadId?: string): Promise<PullRun[]> {
    return selectAll((from, to) => {
      let query = supabase.from("latest_pull_runs").select("*");
      if (leadId) query = query.eq("lead_id", leadId);
      return query.order("lead_id").range(from, to);
    });
  },
};
