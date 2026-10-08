import type { MonthKey } from "@lvt/shared";
import { buildSerpTask, currentMonthKey, extractOrganicRank } from "@lvt/shared";
export { INTERRUPTED_RUN_ERROR } from "@lvt/shared";
import type { SerpClient } from "./serp-client";

export interface PullLead {
  id: string;
  website_domain: string | null;
  data4seo_location_code: number | null;
}

export interface PullPhrase {
  id: string;
  phrase_text: string;
}

export interface RunPatch {
  status?: "succeeded" | "failed";
  phrases_done?: number;
  phrases_failed?: number;
  error?: string | null;
  finished_at?: string;
}

export interface PullRepo {
  getLead(leadId: string): Promise<PullLead | null>;
  /** Non-heading phrases only. */
  listPhrases(leadId: string): Promise<PullPhrase[]>;
  /** Marks "running" runs as failed with INTERRUPTED_RUN_ERROR - for one lead, or every lead when omitted. */
  failInterruptedRuns(leadId?: string): Promise<void>;
  createRun(leadId: string, phrasesTotal: number, failure?: string): Promise<string>;
  updateRun(runId: string, patch: RunPatch): Promise<void>;
  /** Overwrites any earlier value for the month. */
  saveRanking(phraseId: string, month: MonthKey, position: number): Promise<void>;
  /** Writes NULL only when the month has no row yet - an error never erases a real position. */
  saveBlankIfMissing(phraseId: string, month: MonthKey): Promise<void>;
  markLeadPulled(leadId: string, at: Date): Promise<void>;
  listActiveLeadIds(): Promise<string[]>;
}

export interface PullDeps {
  repo: PullRepo;
  serp: SerpClient;
  /** Shared across every lead so pull-all respects the account-wide concurrency limit. */
  limit: <T>(fn: () => Promise<T>) => Promise<T>;
  /**
   * Lead ids this process is pulling. Runs exist only in this process's memory, so a "running" row for
   * a lead not in this set was orphaned by a crash or restart. Assumes a single API instance.
   */
  inFlight: Set<string>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

/** Waits before each retry of the final run write. */
const FINAL_WRITE_RETRY_MS = [500, 2000];

export class PullConflictError extends Error {}
export class LeadNotFoundError extends Error {}

class FatalPullError extends Error {}

/** Shared by the leads of one pull-all: an account-level error in any lead stops the rest. */
interface AccountState {
  failure: string | null;
}

export interface StartedPull {
  runId: string;
  /** Settles when the run is finished. Never rejects - failures are recorded on the run. */
  done: Promise<void>;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Starts a ranking pull for one lead and returns as soon as the run row exists.
 * Spec section 6: a phrase that errors is stored as NULL with no automatic retry; the lead's
 * other phrases continue. Account-level errors stop the lead and mark the run failed.
 */
export async function startLeadPull(deps: PullDeps, leadId: string, account: AccountState = { failure: null }): Promise<StartedPull> {
  const now = deps.now ?? (() => new Date());
  // Claimed before the first await so two simultaneous requests cannot both pass the check.
  if (deps.inFlight.has(leadId)) throw new PullConflictError("A ranking pull is already running for this lead");
  deps.inFlight.add(leadId);
  const release = () => deps.inFlight.delete(leadId);

  try {
    const lead = await deps.repo.getLead(leadId);
    if (!lead) throw new LeadNotFoundError(`Lead ${leadId} not found`);
    await deps.repo.failInterruptedRuns(leadId);

    const phrases = await deps.repo.listPhrases(leadId);
    const target = pullTarget(lead, phrases);
    if (!target.ok) {
      const runId = await deps.repo.createRun(leadId, phrases.length, target.reason);
      release();
      return { runId, done: Promise.resolve() };
    }

    const runId = await deps.repo.createRun(leadId, phrases.length);
    const month = currentMonthKey(now());
    const job = { leadId, runId, domain: target.domain, locationCode: target.locationCode, month, phrases, now, account };
    return { runId, done: runPull(deps, job).finally(release) };
  } catch (err) {
    release();
    throw err;
  }
}

type PullTarget = { ok: true; domain: string; locationCode: number } | { ok: false; reason: string };

function pullTarget(lead: PullLead, phrases: PullPhrase[]): PullTarget {
  const domain = lead.website_domain?.trim() ?? "";
  if (!domain) return { ok: false, reason: "Lead has no website domain" };
  if (lead.data4seo_location_code === null) return { ok: false, reason: "Lead has no location" };
  if (phrases.length === 0) return { ok: false, reason: "Lead has no phrases to pull" };
  return { ok: true, domain, locationCode: lead.data4seo_location_code };
}

async function runPull(
  deps: PullDeps,
  job: { leadId: string; runId: string; domain: string; locationCode: number; month: MonthKey; phrases: PullPhrase[]; now: () => Date; account: AccountState },
): Promise<void> {
  const { repo, serp, limit } = deps;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let done = 0;
  let failed = 0;
  let ranked = 0;
  let fatal: FatalPullError | null = null;

  // Counter writes are chained so a slower earlier write never lands after a newer one.
  let progress = Promise.resolve();
  const reportProgress = () => {
    const patch = { phrases_done: done, phrases_failed: failed };
    progress = progress.then(() => repo.updateRun(job.runId, patch)).catch(() => undefined);
  };

  const stopped = () => fatal !== null || job.account.failure !== null;

  const pullPhrase = async (phrase: PullPhrase) => {
    if (stopped()) return;
    let outcome;
    try {
      const response = await serp.fetchSerp(buildSerpTask(phrase.phrase_text, job.locationCode), { targetDomain: job.domain, month: job.month });
      outcome = extractOrganicRank(response, job.domain);
    } catch (err) {
      outcome = { kind: "error" as const, fatal: false, statusCode: 0, message: describe(err) };
    }
    if (stopped()) return;

    if (outcome.kind === "ranked") {
      await repo.saveRanking(phrase.id, job.month, outcome.position);
      ranked++;
    } else if (outcome.fatal) {
      fatal = new FatalPullError(`DataForSEO ${outcome.statusCode}: ${outcome.message}`);
      job.account.failure = fatal.message;
      return;
    } else {
      await repo.saveBlankIfMissing(phrase.id, job.month);
      failed++;
    }
    done++;
    reportProgress();
  };

  const settled = await Promise.allSettled(job.phrases.map((phrase) => limit(() => pullPhrase(phrase))));
  const rejection = settled.find((s): s is PromiseRejectedResult => s.status === "rejected");
  const crash = rejection ? describe(rejection.reason) : null;
  await progress;

  const ownFatal = (fatal as FatalPullError | null)?.message;
  const stoppedByOtherLead = !ownFatal && job.account.failure !== null && done < job.phrases.length ? `Stopped - ${job.account.failure}` : null;
  const error = ownFatal ?? stoppedByOtherLead ?? crash ?? (ranked === 0 ? "Every phrase failed - try pulling again" : null);
  const finish = async () => {
    if (ranked > 0) await repo.markLeadPulled(job.leadId, job.now());
    await repo.updateRun(job.runId, {
      status: error ? "failed" : "succeeded",
      phrases_done: done,
      phrases_failed: failed,
      error,
      finished_at: job.now().toISOString(),
    });
  };
  for (let attempt = 0; ; attempt++) {
    try {
      await finish();
      return;
    } catch {
      const delay = FINAL_WRITE_RETRY_MS[attempt];
      // Out of retries: the row stays "running" until the next pull of this lead or an API restart marks it interrupted.
      if (delay === undefined) return;
      await sleep(delay);
    }
  }
}

export interface PullAllResult {
  started: Array<{ leadId: string; runId: string }>;
  skipped: Array<{ leadId: string; reason: string }>;
  /** Settles when every started run has finished. */
  done: Promise<void>;
}

/** Spec section 6: every active lead is queued at once; one lead failing never stops the others. */
export async function startPullAll(deps: PullDeps): Promise<PullAllResult> {
  const leadIds = await deps.repo.listActiveLeadIds();
  const started: PullAllResult["started"] = [];
  const skipped: PullAllResult["skipped"] = [];
  const pending: Promise<void>[] = [];
  const account: AccountState = { failure: null };

  for (const leadId of leadIds) {
    try {
      const pull = await startLeadPull(deps, leadId, account);
      started.push({ leadId, runId: pull.runId });
      pending.push(pull.done);
    } catch (err) {
      skipped.push({ leadId, reason: describe(err) });
    }
  }
  return { started, skipped, done: Promise.all(pending).then(() => undefined) };
}
