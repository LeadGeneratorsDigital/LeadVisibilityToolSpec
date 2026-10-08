import type { LeadRankingCell } from "./insights";
import { supabase } from "./supabase";
import type { BuyerGroup, Contact, Lead, LocationCode, Phrase, PullRun, Ranking } from "./types";

function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  if (result.data === null) throw new Error("No data returned");
  return result.data;
}

export const MAX_CONTACTS = 5;

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

  async buyerGroups(leadId: string): Promise<BuyerGroup[]> {
    return unwrap(await supabase.from("buyer_groups").select("*").eq("lead_id", leadId).order("sort_order"));
  },

  async phrases(leadId: string): Promise<Phrase[]> {
    return unwrap(await supabase.from("phrases").select("*").eq("lead_id", leadId).order("sort_order"));
  },

  async rankings(phraseIds: string[]): Promise<Ranking[]> {
    if (phraseIds.length === 0) return [];
    return selectAll((from, to) => supabase.from("rankings").select("phrase_id, month, position").in("phrase_id", phraseIds).order("id").range(from, to));
  },

  /** Ranking cells for every lead since `sinceMonth`, tagged with the owning lead, for dashboard summaries. */
  async leadRankingCells(sinceMonth: string): Promise<LeadRankingCell[]> {
    const rows = (await selectAll((from, to) =>
      supabase
        .from("rankings")
        .select("month, position, phrases!inner(lead_id, is_heading)")
        .gte("month", sinceMonth)
        .eq("phrases.is_heading", false)
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

  async addPhrase(leadId: string, buyerGroupId: string | null, text: string, sortOrder: number): Promise<void> {
    unwrap(await supabase.from("phrases").insert({ lead_id: leadId, buyer_group_id: buyerGroupId, phrase_text: text, sort_order: sortOrder }).select("id"));
  },

  async deletePhrase(id: string): Promise<void> {
    unwrap(await supabase.from("phrases").delete().eq("id", id).select("id"));
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
