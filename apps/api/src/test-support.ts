import type { SerpResponse } from "@lvt/shared";
import type { NewSnapshot, PullLead, PullPhrase, PullRepo, RankingCheck, RunPatch, SavedSnapshot } from "./pull-service";
import { INTERRUPTED_RUN_ERROR } from "@lvt/shared";
import { PullConflictError } from "./pull-service";
import type { SerpClient } from "./serp-client";

export interface FakeRun {
  id: string;
  leadId: string;
  status: "running" | "succeeded" | "failed";
  phrases_total: number;
  phrases_done: number;
  phrases_failed: number;
  error: string | null;
  started_at: Date;
  finished_at: string | null;
}

/** In-memory PullRepo mirroring the SQL semantics of supabase-repo.ts (upsert vs insert-if-missing, one running run per lead). */
export class FakeRepo implements PullRepo {
  leads = new Map<string, PullLead & { last_ranking_pull: Date | null }>();
  phrases = new Map<string, Array<PullPhrase & { archived?: boolean }>>();
  rankings = new Map<string, number | null>();
  checks = new Map<string, RankingCheck>();
  snapshots: Array<NewSnapshot & { id: string }> = [];
  runs: FakeRun[] = [];
  failSaveRankingFor = new Set<string>();
  failSaveSnapshot = false;

  addLead(id: string, phrases: string[], overrides: Partial<PullLead> = {}) {
    this.leads.set(id, { id, website_domain: "lead.co.uk", data4seo_location_code: 2826, last_ranking_pull: null, ...overrides });
    this.phrases.set(id, phrases.map((text, i) => ({ id: `${id}-p${i}`, phrase_text: text })));
  }

  ranking(phraseId: string, month: string) {
    return this.rankings.get(`${phraseId}|${month}`);
  }

  check(phraseId: string, month: string) {
    return this.checks.get(`${phraseId}|${month}`);
  }

  async getLead(leadId: string) {
    return this.leads.get(leadId) ?? null;
  }
  async listPhrases(leadId: string) {
    return (this.phrases.get(leadId) ?? []).filter((p) => !p.archived).map(({ id, phrase_text }) => ({ id, phrase_text }));
  }
  async listRankedPhraseIds(phraseIds: string[], month: string) {
    return new Set(phraseIds.filter((id) => typeof this.ranking(id, month) === "number"));
  }
  async findFreshSnapshot(keywordKey: string, locationCode: number, since: Date): Promise<SavedSnapshot | null> {
    const match = this.snapshots
      .filter((s) => s.keywordKey === keywordKey && s.locationCode === locationCode && s.fetchedAt >= since)
      .sort((a, b) => b.fetchedAt.getTime() - a.fetchedAt.getTime())[0];
    return match ? { id: match.id, fetched_at: match.fetchedAt, items: match.items } : null;
  }
  async saveSnapshot(snapshot: NewSnapshot) {
    if (this.failSaveSnapshot) throw new Error("snapshot write failed");
    const id = `snap-${this.snapshots.length + 1}`;
    this.snapshots.push({ ...snapshot, id });
    return id;
  }
  async failInterruptedRuns(leadId?: string) {
    for (const run of this.runs) {
      if (run.status === "running" && (!leadId || run.leadId === leadId)) {
        Object.assign(run, { status: "failed", error: INTERRUPTED_RUN_ERROR, finished_at: new Date().toISOString() });
      }
    }
  }
  async createRun(leadId: string, phrasesTotal: number, failure?: string) {
    if (!failure && this.runs.some((r) => r.leadId === leadId && r.status === "running")) {
      throw new PullConflictError("A ranking pull is already running for this lead");
    }
    const id = `run-${this.runs.length + 1}`;
    this.runs.push({
      id,
      leadId,
      status: failure ? "failed" : "running",
      phrases_total: phrasesTotal,
      phrases_done: 0,
      phrases_failed: 0,
      error: failure ?? null,
      started_at: new Date(),
      finished_at: failure ? new Date().toISOString() : null,
    });
    return id;
  }
  async updateRun(runId: string, patch: RunPatch) {
    const run = this.runs.find((r) => r.id === runId);
    if (!run) throw new Error(`no run ${runId}`);
    Object.assign(run, patch);
  }
  async saveRanking(phraseId: string, month: string, position: number, check: RankingCheck) {
    if (this.failSaveRankingFor.has(phraseId)) throw new Error("db write failed");
    this.rankings.set(`${phraseId}|${month}`, position);
    this.checks.set(`${phraseId}|${month}`, check);
  }
  async saveBlankIfMissing(phraseId: string, month: string) {
    const key = `${phraseId}|${month}`;
    if (!this.rankings.has(key)) this.rankings.set(key, null);
  }
  async markLeadPulled(leadId: string, at: Date) {
    this.leads.get(leadId)!.last_ranking_pull = at;
  }
}

export function serpWithOrganic(domains: string[], cost = 0): SerpResponse {
  return {
    version: "t",
    status_code: 20000,
    status_message: "Ok.",
    time: "0",
    cost,
    tasks_count: 1,
    tasks_error: 0,
    tasks: [
      {
        id: "t",
        status_code: 20000,
        status_message: "Ok.",
        time: "0",
        cost,
        result_count: 1,
        path: [],
        data: {},
        result: [
          {
            keyword: "k",
            type: "organic",
            se_domain: "google.co.uk",
            location_code: 2826,
            language_code: "en",
            check_url: "",
            datetime: "",
            item_types: ["organic"],
            se_results_count: 1,
            items_count: domains.length,
            items: domains.map((domain, i) => ({
              type: "organic" as const,
              rank_group: i + 1,
              rank_absolute: i + 1,
              page: 1,
              domain,
              title: "",
              description: null,
              url: `https://${domain}/`,
              breadcrumb: null,
            })),
          },
        ],
      },
    ],
  };
}

export function serpTaskError(code: number, message = "error"): SerpResponse {
  const ok = serpWithOrganic([]);
  return { ...ok, tasks_error: 1, tasks: [{ ...ok.tasks![0]!, status_code: code, status_message: message, result: null }] };
}

/** Serp client whose answer is chosen per keyword. Reusable like the live client unless told otherwise. */
export function scriptedSerp(answer: (keyword: string) => SerpResponse | Error, reusable = true): SerpClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    mode: "mock",
    reusable,
    calls,
    async fetchSerp(task) {
      calls.push(task.keyword);
      const result = answer(task.keyword);
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

export const unlimited = <T>(fn: () => Promise<T>) => fn();
