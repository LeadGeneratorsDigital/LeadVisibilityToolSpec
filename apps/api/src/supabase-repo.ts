import type { SupabaseClient } from "@supabase/supabase-js";
import type { SnapshotItem } from "@lvt/shared";
import type { PullRepo } from "./pull-service";
import { PullConflictError } from "./pull-service";
import { INTERRUPTED_RUN_ERROR } from "@lvt/shared";

/** Postgres unique_violation; on ranking_pull_runs it can only be the one-running-run index (see PullDeps.inFlight for what it can and cannot catch). */
const UNIQUE_VIOLATION = "23505";

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
        await db.from("phrases").select("id, phrase_text").eq("lead_id", leadId).eq("is_heading", false).is("archived_at", null).order("sort_order"),
        "Load phrases",
      );
    },

    async listRankedPhraseIds(phraseIds, month) {
      if (phraseIds.length === 0) return new Set();
      const ranked = rows(
        await db.from("rankings").select("phrase_id").in("phrase_id", phraseIds).eq("month", month).not("position", "is", null),
        "Load this month's rankings",
      );
      return new Set(ranked.map((r) => r.phrase_id as string));
    },

    async findFreshSnapshot(keywordKey, locationCode, since) {
      const data = check(
        await db
          .from("serp_snapshots")
          .select("id, fetched_at, items")
          .eq("keyword_key", keywordKey)
          .eq("location_code", locationCode)
          .gte("fetched_at", since.toISOString())
          .order("fetched_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        "Load saved check",
      );
      if (!data) return null;
      return { id: data.id as string, fetched_at: new Date(data.fetched_at as string), items: data.items as SnapshotItem[] };
    },

    async saveSnapshot(snapshot) {
      const row = {
        keyword_key: snapshot.keywordKey,
        keyword: snapshot.keyword,
        location_code: snapshot.locationCode,
        cost: snapshot.cost,
        items: snapshot.items,
        fetched_at: snapshot.fetchedAt.toISOString(),
      };
      return single<{ id: string }>(await db.from("serp_snapshots").insert(row).select("id").single(), "Save check").id;
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
      const result = await db.from("ranking_pull_runs").insert(row).select("id").single();
      if ((result.error as { code?: string } | null)?.code === UNIQUE_VIOLATION) {
        throw new PullConflictError("A ranking pull is already running for this lead");
      }
      return single<{ id: string }>(result, "Create pull run").id;
    },

    async updateRun(runId, patch) {
      check(await db.from("ranking_pull_runs").update(patch).eq("id", runId), "Update pull run");
    },

    async saveRanking(phraseId, month, position, { checkedAt, snapshotId }) {
      const row = { phrase_id: phraseId, month, position, checked_at: checkedAt.toISOString(), snapshot_id: snapshotId };
      check(await db.from("rankings").upsert(row, { onConflict: "phrase_id,month" }), "Save ranking");
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
  };
}
