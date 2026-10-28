import type { MonthKey, RankOutcome, SerpResponse, SnapshotItem } from "@lvt/shared";
import { buildSerpTask, currentMonthKey, extractOrganicRank, keywordKey, rankInSnapshot, snapshotFromResponse } from "@lvt/shared";
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

export interface SavedSnapshot {
  id: string;
  fetched_at: Date;
  items: SnapshotItem[];
}

export interface NewSnapshot {
  keywordKey: string;
  keyword: string;
  locationCode: number;
  cost: number;
  items: SnapshotItem[];
  fetchedAt: Date;
}

/** Where a stored position came from: when Google was checked, and the saved result set (null when none was kept). */
export interface RankingCheck {
  checkedAt: Date;
  snapshotId: string | null;
}

export interface PullRepo {
  getLead(leadId: string): Promise<PullLead | null>;
  /** Non-heading, non-archived phrases only. */
  listPhrases(leadId: string): Promise<PullPhrase[]>;
  /** Of `phraseIds`, those that already have a real (non-NULL) position for the month. */
  listRankedPhraseIds(phraseIds: string[], month: MonthKey): Promise<Set<string>>;
  /** Newest snapshot for the keyword + location fetched at or after `since`. */
  findFreshSnapshot(keywordKey: string, locationCode: number, since: Date): Promise<SavedSnapshot | null>;
  saveSnapshot(snapshot: NewSnapshot): Promise<string>;
  /** Marks "running" runs as failed with INTERRUPTED_RUN_ERROR - for one lead, or every lead when omitted. */
  failInterruptedRuns(leadId?: string): Promise<void>;
  createRun(leadId: string, phrasesTotal: number, failure?: string): Promise<string>;
  updateRun(runId: string, patch: RunPatch): Promise<void>;
  /** Overwrites any earlier value for the month. */
  saveRanking(phraseId: string, month: MonthKey, position: number, check: RankingCheck): Promise<void>;
  /** Writes NULL only when the month has no row yet - an error never erases a real position. */
  saveBlankIfMissing(phraseId: string, month: MonthKey): Promise<void>;
  markLeadPulled(leadId: string, at: Date): Promise<void>;
}

export interface PullDeps {
  repo: PullRepo;
  serp: SerpClient;
  /** Shared across every lead so simultaneous pulls respect the account-wide concurrency limit. */
  limit: <T>(fn: () => Promise<T>) => Promise<T>;
  /**
   * Lead ids this process is pulling. Runs exist only in this process's memory, so a "running" row for
   * a lead not in this set is treated as orphaned by a crash or restart and marked interrupted.
   * Only one API instance is supported: a second instance would mark the first one's live runs
   * interrupted, and the one-running-run index cannot stop it because that sweep runs before the insert.
   */
  inFlight: Set<string>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** How old a saved check may be and still be reused instead of paying for a new one. */
  snapshotMaxAgeMs?: number;
  /** Reports saved-check failures that the pull works around; defaults to console.warn. */
  warn?: (message: string) => void;
}

export interface PullOptions {
  /** Check every phrase with DataForSEO again, even ones already ranked this month or checked recently. */
  force?: boolean;
}

export const SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Waits before each retry of the final run write. */
const FINAL_WRITE_RETRY_MS = [500, 2000];

export class PullConflictError extends Error {}
export class LeadNotFoundError extends Error {}

class FatalPullError extends Error {}

/** Where one keyword + location check was answered from. */
type Resolution =
  | { source: "saved"; snapshot: SavedSnapshot }
  | { source: "fetched"; response: SerpResponse; fetchedAt: Date; snapshotId: string | null };

/**
 * Shared by one lead's pull: an account-level error stops the remaining phrases, and a keyword +
 * location listed twice (the same phrase under two headings) is checked once.
 */
interface PullBatch {
  failure: string | null;
  checks: Map<string, Promise<Resolution>>;
}

function newBatch(): PullBatch {
  return { failure: null, checks: new Map() };
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
 * Without `force`, phrases already ranked this month are skipped, so a repeated pull costs nothing.
 */
export async function startLeadPull(deps: PullDeps, leadId: string, options: PullOptions = {}): Promise<StartedPull> {
  const now = deps.now ?? (() => new Date());
  const force = options.force === true;
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

    const month = currentMonthKey(now());
    const ranked = force ? new Set<string>() : await deps.repo.listRankedPhraseIds(phrases.map((p) => p.id), month);
    const pending = phrases.filter((p) => !ranked.has(p.id));
    const runId = await deps.repo.createRun(leadId, phrases.length);
    const job: PullJob = { leadId, runId, domain: target.domain, locationCode: target.locationCode, month, pending, skipped: phrases.length - pending.length, force, now, batch: newBatch() };
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

interface PullJob {
  leadId: string;
  runId: string;
  domain: string;
  locationCode: number;
  month: MonthKey;
  /** Phrases to check in this run. */
  pending: PullPhrase[];
  /** Phrases already ranked this month; they count as done without a check. */
  skipped: number;
  force: boolean;
  now: () => Date;
  batch: PullBatch;
}

/**
 * Answers one keyword + location: a saved check from this month that is younger than the max age,
 * otherwise a paid DataForSEO call whose complete result set is saved for the next lead or pull.
 * With a reusable client, leads in one batch asking for the same keyword + location share one answer.
 */
function resolveCheck(deps: PullDeps, job: PullJob, phrase: PullPhrase): Promise<Resolution> {
  const { repo, serp } = deps;
  const warn = deps.warn ?? console.warn;
  const key = keywordKey(phrase.phrase_text);
  const label = `"${phrase.phrase_text}" (${job.locationCode})`;
  const resolve = async (): Promise<Resolution> => {
    if (serp.reusable && !job.force) {
      const since = new Date(job.now().getTime() - (deps.snapshotMaxAgeMs ?? SNAPSHOT_MAX_AGE_MS));
      // A lookup failure is shared by every lead waiting on this check, so it must fall back to a paid check, not blank them all.
      const saved = await repo.findFreshSnapshot(key, job.locationCode, since).catch((err: unknown) => {
        warn(`Saved check lookup failed for ${label} - checking DataForSEO instead: ${describe(err)}`);
        return null;
      });
      // A check from last month must not fill this month's column, however recent it is.
      if (saved && currentMonthKey(saved.fetched_at) === job.month) return { source: "saved", snapshot: saved };
    }
    const response = await serp.fetchSerp(buildSerpTask(phrase.phrase_text, job.locationCode), { targetDomain: job.domain, month: job.month });
    const fetchedAt = job.now();
    const data = serp.reusable ? snapshotFromResponse(response) : null;
    // A failed snapshot write must not throw away a paid result; the position still saves, unlinked.
    const snapshotId = data
      ? await repo
          .saveSnapshot({ keywordKey: key, keyword: phrase.phrase_text, locationCode: job.locationCode, cost: data.cost, items: data.items, fetchedAt })
          .catch((err: unknown) => {
            warn(`Could not save the check for ${label}; its position is saved unlinked: ${describe(err)}`);
            return null;
          })
      : null;
    return { source: "fetched", response, fetchedAt, snapshotId };
  };

  if (!serp.reusable) return resolve();
  const shareKey = `${key}|${job.locationCode}`;
  let check = job.batch.checks.get(shareKey);
  if (!check) {
    check = resolve();
    job.batch.checks.set(shareKey, check);
  }
  return check;
}

function rankFor(resolution: Resolution, domain: string): { outcome: RankOutcome; check: RankingCheck } {
  if (resolution.source === "saved") {
    const { snapshot } = resolution;
    return { outcome: { kind: "ranked", position: rankInSnapshot(snapshot.items, domain) }, check: { checkedAt: snapshot.fetched_at, snapshotId: snapshot.id } };
  }
  return { outcome: extractOrganicRank(resolution.response, domain), check: { checkedAt: resolution.fetchedAt, snapshotId: resolution.snapshotId } };
}

async function runPull(deps: PullDeps, job: PullJob): Promise<void> {
  const { repo, limit } = deps;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const total = job.skipped + job.pending.length;
  let done = job.skipped;
  let failed = 0;
  let ranked = 0;
  let fatal: FatalPullError | null = null;

  // Counter writes are chained so a slower earlier write never lands after a newer one.
  let progress = Promise.resolve();
  const reportProgress = () => {
    const patch = { phrases_done: done, phrases_failed: failed };
    progress = progress.then(() => repo.updateRun(job.runId, patch)).catch(() => undefined);
  };

  const stopped = () => fatal !== null || job.batch.failure !== null;

  const pullPhrase = async (phrase: PullPhrase) => {
    if (stopped()) return;
    let result: { outcome: RankOutcome; check: RankingCheck | null };
    try {
      result = rankFor(await resolveCheck(deps, job, phrase), job.domain);
    } catch (err) {
      result = { outcome: { kind: "error", fatal: false, statusCode: 0, message: describe(err) }, check: null };
    }
    if (stopped()) return;

    const { outcome, check } = result;
    if (outcome.kind === "ranked") {
      await repo.saveRanking(phrase.id, job.month, outcome.position, check!);
      ranked++;
    } else if (outcome.fatal) {
      fatal = new FatalPullError(`DataForSEO ${outcome.statusCode}: ${outcome.message}`);
      job.batch.failure = fatal.message;
      return;
    } else {
      await repo.saveBlankIfMissing(phrase.id, job.month);
      failed++;
    }
    done++;
    reportProgress();
  };

  const settled = await Promise.allSettled(job.pending.map((phrase) => limit(() => pullPhrase(phrase))));
  const rejection = settled.find((s): s is PromiseRejectedResult => s.status === "rejected");
  const crash = rejection ? describe(rejection.reason) : null;
  await progress;

  const ownFatal = (fatal as FatalPullError | null)?.message;
  const error = ownFatal ?? crash ?? (ranked === 0 && job.skipped === 0 ? "Every phrase failed - try updating again" : null);
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
