import type { SerpResponse } from "@lvt/shared";
import type { PullLead, PullPhrase, PullRepo, RunPatch } from "./pull-service";
import { INTERRUPTED_RUN_ERROR } from "@lvt/shared";
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

/** In-memory PullRepo mirroring the SQL semantics of supabase-repo.ts (upsert vs insert-if-missing). */
export class FakeRepo implements PullRepo {
  leads = new Map<string, PullLead & { status: string; last_ranking_pull: Date | null }>();
  phrases = new Map<string, PullPhrase[]>();
  rankings = new Map<string, number | null>();
  runs: FakeRun[] = [];
  failSaveRankingFor = new Set<string>();

  addLead(id: string, phrases: string[], overrides: Partial<PullLead & { status: string }> = {}) {
    this.leads.set(id, { id, website_domain: "lead.co.uk", data4seo_location_code: 2826, status: "active", last_ranking_pull: null, ...overrides });
    this.phrases.set(id, phrases.map((text, i) => ({ id: `${id}-p${i}`, phrase_text: text })));
  }

  ranking(phraseId: string, month: string) {
    return this.rankings.get(`${phraseId}|${month}`);
  }

  async getLead(leadId: string) {
    return this.leads.get(leadId) ?? null;
  }
  async listPhrases(leadId: string) {
    return this.phrases.get(leadId) ?? [];
  }
  async failInterruptedRuns(leadId?: string) {
    for (const run of this.runs) {
      if (run.status === "running" && (!leadId || run.leadId === leadId)) {
        Object.assign(run, { status: "failed", error: INTERRUPTED_RUN_ERROR, finished_at: new Date().toISOString() });
      }
    }
  }
  async createRun(leadId: string, phrasesTotal: number, failure?: string) {
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
  async saveRanking(phraseId: string, month: string, position: number) {
    if (this.failSaveRankingFor.has(phraseId)) throw new Error("db write failed");
    this.rankings.set(`${phraseId}|${month}`, position);
  }
  async saveBlankIfMissing(phraseId: string, month: string) {
    const key = `${phraseId}|${month}`;
    if (!this.rankings.has(key)) this.rankings.set(key, null);
  }
  async markLeadPulled(leadId: string, at: Date) {
    this.leads.get(leadId)!.last_ranking_pull = at;
  }
  async listActiveLeadIds() {
    return [...this.leads.values()].filter((l) => l.status === "active").map((l) => l.id);
  }
}

export function serpWithOrganic(domains: string[]): SerpResponse {
  return {
    version: "t",
    status_code: 20000,
    status_message: "Ok.",
    time: "0",
    cost: 0,
    tasks_count: 1,
    tasks_error: 0,
    tasks: [
      {
        id: "t",
        status_code: 20000,
        status_message: "Ok.",
        time: "0",
        cost: 0,
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

/** Serp client whose answer is chosen per keyword. */
export function scriptedSerp(answer: (keyword: string) => SerpResponse | Error): SerpClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    mode: "mock",
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
