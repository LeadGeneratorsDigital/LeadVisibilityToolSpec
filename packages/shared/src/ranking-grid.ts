import type { MonthKey } from "./month";
import { formatMonthHeader, monthsEndingAt } from "./month";
import { NOT_RANKED_POSITION, VISIBILITY_LABEL, visibilityFor } from "./visibility";

export interface BuyerGroupInput {
  id: string;
  name: string;
  sort_order: number;
}

export interface PhraseInput {
  id: string;
  buyer_group_id: string | null;
  phrase_text: string;
  is_heading: boolean;
  sort_order: number;
}

export interface RankingInput {
  phrase_id: string;
  month: MonthKey;
  position: number | null;
}

export type GridRow =
  | { kind: "heading"; key: string; label: string }
  | { kind: "phrase"; key: string; phraseId: string; label: string; positions: Record<MonthKey, number | null | undefined> };

function bySortOrder<T extends { sort_order: number }>(a: T, b: T): number {
  return a.sort_order - b.sort_order;
}

function monthIndex(month: MonthKey): number {
  return Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
}

/** Every month from the earliest to the latest ranking, gaps included, oldest first. */
export function historyMonths(rankings: RankingInput[]): MonthKey[] {
  if (rankings.length === 0) return [];
  const sorted = rankings.map((r) => r.month).sort();
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  return monthsEndingAt(last, monthIndex(last) - monthIndex(first) + 1);
}

/**
 * Rows in display order: ungrouped phrases first, then each buyer group as a heading followed by
 * its phrases. Phrases flagged `is_heading` (FRT import parity) render as heading rows in place.
 * A month with no ranking row is `undefined`; a stored NULL (API error) is `null`.
 */
export function buildRankingGrid(groups: BuyerGroupInput[], phrases: PhraseInput[], rankings: RankingInput[]): GridRow[] {
  const byPhrase = new Map<string, Record<MonthKey, number | null>>();
  for (const r of rankings) {
    const row = byPhrase.get(r.phrase_id) ?? {};
    row[r.month] = r.position;
    byPhrase.set(r.phrase_id, row);
  }

  const toRow = (p: PhraseInput): GridRow =>
    p.is_heading
      ? { kind: "heading", key: p.id, label: p.phrase_text }
      : { kind: "phrase", key: p.id, phraseId: p.id, label: p.phrase_text, positions: byPhrase.get(p.id) ?? {} };

  const knownGroups = new Set(groups.map((g) => g.id));
  const ungrouped = phrases.filter((p) => p.buyer_group_id === null || !knownGroups.has(p.buyer_group_id));
  const rows: GridRow[] = [...ungrouped].sort(bySortOrder).map(toRow);

  for (const group of [...groups].sort(bySortOrder)) {
    rows.push({ kind: "heading", key: `group-${group.id}`, label: group.name });
    rows.push(...phrases.filter((p) => p.buyer_group_id === group.id).sort(bySortOrder).map(toRow));
  }
  return rows;
}

/** Plain-text cell for copy/paste. Blank = no data. */
export function positionText(position: number | null | undefined): string {
  if (position === null || position === undefined) return "";
  const label = VISIBILITY_LABEL[visibilityFor(position)!];
  return position === NOT_RANKED_POSITION ? `${label} (not in top 100)` : `${label} (#${position})`;
}

export const CHATGPT_HISTORY_MONTHS = 6;

export interface ChatGptCopyInput {
  leadName: string;
  brief: string;
  rows: GridRow[];
  rankings: RankingInput[];
}

/**
 * Spec section 6: lead name on line 1, then the brief, then a tab-separated table of the last
 * six ranking months (ending at the latest month with data) for every phrase.
 */
export function buildChatGptCopy({ leadName, brief, rows, rankings }: ChatGptCopyInput): string {
  const all = historyMonths(rankings);
  const latest = all[all.length - 1];
  const months = latest ? monthsEndingAt(latest, CHATGPT_HISTORY_MONTHS) : [];

  const table = [["Phrase", ...months.map(formatMonthHeader)].join("\t")];
  for (const row of rows) {
    if (row.kind === "heading") {
      table.push(row.label);
    } else {
      table.push([row.label, ...months.map((m) => positionText(row.positions[m]))].join("\t"));
    }
  }

  return [leadName, "", brief.trim() || "(No brief yet)", "", "Google rankings - last 6 months", table.join("\n")].join("\n");
}
