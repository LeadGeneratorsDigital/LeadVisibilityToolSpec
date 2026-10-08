import type { SupabaseClient } from "@supabase/supabase-js";
import type { PullRepo } from "./pull-service";
import { INTERRUPTED_RUN_ERROR } from "@lvt/shared";

function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data;
}

function rows<T>(result: { data: T[] | null; error: { message: string } | null }, what: string): T[] {
  return check(result, what) ?? [];
}

function single<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  const data = check(result, what);
  if (data === null) throw new Error(`${what}: no row returned`);
  return data;
}

export function createSupabasePullRepo(db: SupabaseClient): PullRepo {
  return {
    async getLead(leadId) {
      const data = check(
        await db.from("leads").select("id, website_domain, location_codes(data4seo_location_code)").eq("id", leadId).maybeSingle(),
        "Load lead",
      );
      if (!data) return null;
      const location = data.location_codes as unknown as { data4seo_location_code: number } | null;
      return { id: data.id, website_domain: data.website_domain, data4seo_location_code: location?.data4seo_location_code ?? null };
    },

    async listPhrases(leadId) {
      return rows(
        await db.from("phrases").select("id, phrase_text").eq("lead_id", leadId).eq("is_heading", false).order("sort_order"),
        "Load phrases",
      );
    },

    async failInterruptedRuns(leadId) {
      let query = db
        .from("ranking_pull_runs")
        .update({ status: "failed", error: INTERRUPTED_RUN_ERROR, finished_at: new Date().toISOString() })
        .eq("status", "running");
      if (leadId) query = query.eq("lead_id", leadId);
      check(await query, "Mark interrupted pulls");
    },

    async createRun(leadId, phrasesTotal, failure) {
      const row: Record<string, unknown> = { lead_id: leadId, phrases_total: phrasesTotal };
      if (failure) Object.assign(row, { status: "failed", error: failure, finished_at: new Date().toISOString() });
      return single<{ id: string }>(await db.from("ranking_pull_runs").insert(row).select("id").single(), "Create pull run").id;
    },

    async updateRun(runId, patch) {
      check(await db.from("ranking_pull_runs").update(patch).eq("id", runId), "Update pull run");
    },

    async saveRanking(phraseId, month, position) {
      check(await db.from("rankings").upsert({ phrase_id: phraseId, month, position }, { onConflict: "phrase_id,month" }), "Save ranking");
    },

    async saveBlankIfMissing(phraseId, month) {
      check(
        await db.from("rankings").upsert({ phrase_id: phraseId, month, position: null }, { onConflict: "phrase_id,month", ignoreDuplicates: true }),
        "Save blank ranking",
      );
    },

    async markLeadPulled(leadId, at) {
      check(await db.from("leads").update({ last_ranking_pull: at.toISOString() }).eq("id", leadId), "Mark lead pulled");
    },

    async listActiveLeadIds() {
      return rows(await db.from("leads").select("id").eq("status", "active"), "Load active leads").map((r) => r.id as string);
    },
  };
}
