export interface BulkUpdateResult {
  started: string[];
  failed: Array<{ id: string; reason: string }>;
}

/**
 * Starts an update for each lead in turn. Each start only queues the work (the API answers at once
 * and shares one DataForSEO concurrency limit across leads), so one lead failing to start, e.g.
 * because it is already updating, never stops the others.
 */
export async function runBulkUpdate(ids: string[], start: (id: string) => Promise<unknown>): Promise<BulkUpdateResult> {
  const result: BulkUpdateResult = { started: [], failed: [] };
  for (const id of ids) {
    try {
      await start(id);
      result.started.push(id);
    } catch (err) {
      result.failed.push({ id, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return result;
}

/**
 * Which ticked leads to update: only those on screen (a lead hidden by the search or filter is not
 * updated by surprise), and only those with a website and location, which the update needs.
 */
export function bulkTargets<T extends { id: string; business_name: string; website_domain: string | null; location_code: string | null }>(shown: T[], selected: Set<string>): { ready: string[]; skipped: string[] } {
  const ready: string[] = [];
  const skipped: string[] = [];
  for (const lead of shown) {
    if (!selected.has(lead.id)) continue;
    if (lead.website_domain && lead.location_code) ready.push(lead.id);
    else skipped.push(lead.business_name);
  }
  return { ready, skipped };
}

/** Total key phrases of the chosen leads, for the confirm dialog. */
export function phraseTotal(ids: Iterable<string>, counts: Map<string, number>): number {
  let total = 0;
  for (const id of ids) total += counts.get(id) ?? 0;
  return total;
}
