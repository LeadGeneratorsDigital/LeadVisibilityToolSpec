import type { MonthKey } from "./month";
import { formatMonthLong } from "./month";
import { NOT_RANKED_LABEL, NOT_RANKED_POSITION } from "./visibility";

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
  /** When Google was checked for this position; null for blank (error) rows and rows written before checks were recorded. */
  checked_at?: string | null;
}

export type GridRow =
  | { kind: "heading"; key: string; label: string }
  | {
      kind: "phrase";
      key: string;
      phraseId: string;
      label: string;
      positions: Record<MonthKey, number | null | undefined>;
      checkedAt: Record<MonthKey, string | null | undefined>;
    };

function bySortOrder<T extends { sort_order: number }>(a: T, b: T): number {
  return a.sort_order - b.sort_order;
}

/**
 * The months rankings were taken in, oldest first. Months with no check get no column: some leads
 * are only updated every two or three months.
 */
export function historyMonths(rankings: RankingInput[]): MonthKey[] {
  return [...new Set(rankings.map((r) => r.month))].sort();
}

/**
 * Rows in display order: ungrouped phrases first, then each heading (a buyer_groups row) followed by
 * its phrases. Phrases flagged `is_heading` (FRT import parity) render as heading rows in place.
 * A month with no ranking row is `undefined`; a stored NULL (API error) is `null`.
 */
export function buildRankingGrid(groups: BuyerGroupInput[], phrases: PhraseInput[], rankings: RankingInput[]): GridRow[] {
  const byPhrase = new Map<string, { positions: Record<MonthKey, number | null>; checkedAt: Record<MonthKey, string | null> }>();
  for (const r of rankings) {
    const row = byPhrase.get(r.phrase_id) ?? { positions: {}, checkedAt: {} };
    row.positions[r.month] = r.position;
    row.checkedAt[r.month] = r.checked_at ?? null;
    byPhrase.set(r.phrase_id, row);
  }

  const toRow = (p: PhraseInput): GridRow =>
    p.is_heading
      ? { kind: "heading", key: p.id, label: p.phrase_text }
      : { kind: "phrase", key: p.id, phraseId: p.id, label: p.phrase_text, positions: byPhrase.get(p.id)?.positions ?? {}, checkedAt: byPhrase.get(p.id)?.checkedAt ?? {} };

  const knownGroups = new Set(groups.map((g) => g.id));
  const ungrouped = phrases.filter((p) => p.buyer_group_id === null || !knownGroups.has(p.buyer_group_id));
  const rows: GridRow[] = [...ungrouped].sort(bySortOrder).map(toRow);

  for (const group of [...groups].sort(bySortOrder)) {
    rows.push({ kind: "heading", key: `group-${group.id}`, label: group.name });
    rows.push(...phrases.filter((p) => p.buyer_group_id === group.id).sort(bySortOrder).map(toRow));
  }
  return rows;
}

/** CSV cell: the bare position, "Not Ranked", or blank for no data. */
export function csvPositionText(position: number | null | undefined): string {
  if (position === null || position === undefined) return "";
  return position === NOT_RANKED_POSITION ? NOT_RANKED_LABEL : String(position);
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Stage 1 "Copy as CSV": the full ranking table, one row per phrase with its heading, one column
 * per month (oldest first), for pasting into Claude Chat or a spreadsheet.
 */
export function buildRankingCsv(rows: GridRow[], months: MonthKey[]): string {
  const lines = [["Heading", "Key phrase", ...months.map(formatMonthLong)]];
  let group = "";
  for (const row of rows) {
    if (row.kind === "heading") {
      group = row.label;
      continue;
    }
    lines.push([group, row.label, ...months.map((m) => csvPositionText(row.positions[m]))]);
  }
  return lines.map((line) => line.map(csvField).join(",")).join("\n");
}
