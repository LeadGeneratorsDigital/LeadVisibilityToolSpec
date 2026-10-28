import { currentMonthKey, monthsEndingAt, NOT_RANKED_POSITION, VISIBILITY_LABEL, visibilityFor, type GridRow, type MonthKey } from "@lvt/shared";
import { formatDate } from "./format";

export function relativeTime(iso: string | null, now: Date): string {
  if (!iso) return "Never";
  const ms = now.getTime() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "Never";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return formatDate(iso);
}

export interface VisibilityCounts {
  visible: number;
  partly: number;
  invisible: number;
  noData: number;
}

export function countVisibility(positions: Array<number | null | undefined>): VisibilityCounts {
  const counts: VisibilityCounts = { visible: 0, partly: 0, invisible: 0, noData: 0 };
  for (const position of positions) {
    const visibility = position === null || position === undefined ? null : visibilityFor(position);
    if (visibility) counts[visibility]++;
    else counts.noData++;
  }
  return counts;
}

export interface LeadRankingCell {
  lead_id: string;
  month: MonthKey;
  position: number | null;
}

/** Months the leads list reads back: some leads are only updated every two or three months. */
export const VISIBILITY_WINDOW_MONTHS = 6;

/** First month of the leads list's ranking read, the current month included. */
export function visibilitySinceMonth(now: Date): MonthKey {
  return monthsEndingAt(currentMonthKey(now), VISIBILITY_WINDOW_MONTHS)[0]!;
}

/** Per lead: visibility counts for the most recent month that lead has any ranking rows. */
export function latestVisibilityByLead(cells: LeadRankingCell[]): Map<string, { month: MonthKey; counts: VisibilityCounts }> {
  const latestMonth = new Map<string, MonthKey>();
  for (const cell of cells) {
    const current = latestMonth.get(cell.lead_id);
    if (!current || cell.month > current) latestMonth.set(cell.lead_id, cell.month);
  }
  const result = new Map<string, { month: MonthKey; counts: VisibilityCounts }>();
  for (const [leadId, month] of latestMonth) {
    const positions = cells.filter((c) => c.lead_id === leadId && c.month === month).map((c) => c.position);
    result.set(leadId, { month, counts: countVisibility(positions) });
  }
  return result;
}

/**
 * Whether `month` already has results, and how many phrases still lack a real position in it: a
 * failed check is stored blank, a phrase added since the update has no row at all.
 */
export function monthUpdateState(rows: GridRow[], month: MonthKey): { updated: boolean; blanks: number } {
  const phrases = rows.filter((r): r is Extract<GridRow, { kind: "phrase" }> => r.kind === "phrase");
  return {
    updated: phrases.some((p) => p.positions[month] !== undefined),
    blanks: phrases.filter((p) => (p.positions[month] ?? null) === null).length,
  };
}

export type Trend = { direction: "up" | "down" | "same"; places: number } | null;

/** Lower position is better, so moving from #12 to #5 is "up" by 7. Needs a number in both months. */
export function trendBetween(previous: number | null | undefined, latest: number | null | undefined): Trend {
  if (previous === null || previous === undefined || latest === null || latest === undefined) return null;
  const places = previous - latest;
  if (places === 0) return { direction: "same", places: 0 };
  return { direction: places > 0 ? "up" : "down", places: Math.abs(places) };
}

/** Latest-month counts plus how many phrases improved or dropped versus the month before. */
export function rankingSummary(rows: GridRow[], months: MonthKey[]) {
  const latest = months[months.length - 1];
  const previous = months[months.length - 2];
  const phrases = rows.filter((r): r is Extract<GridRow, { kind: "phrase" }> => r.kind === "phrase");
  const counts = countVisibility(phrases.map((p) => (latest ? p.positions[latest] : undefined)));
  let improved = 0;
  let dropped = 0;
  for (const p of phrases) {
    const trend = latest && previous ? trendBetween(p.positions[previous], p.positions[latest]) : null;
    if (trend?.direction === "up") improved++;
    if (trend?.direction === "down") dropped++;
  }
  return { latest, total: phrases.length, counts, improved, dropped };
}

export type TalkingPointKind = "slipped" | "nearly" | "climbed";

export interface TalkingPoint {
  kind: TalkingPointKind;
  phrase: string;
  text: string;
}

/** A move smaller than this is noise unless it crosses a visibility band. */
export const SIGNIFICANT_MOVE = 3;
/** Partly visible positions this close to the top 20 are pitched as quick wins. */
export const NEARLY_VISIBLE_MAX = 30;

function positionText(position: number): string {
  return position === NOT_RANKED_POSITION ? "outside the top 100" : `#${position}`;
}

/**
 * Reasons to call, from the latest month versus the one before: drops first (the strongest hook),
 * then near misses just outside the top 20, then gains worth congratulating.
 */
export function talkingPoints(rows: GridRow[], months: MonthKey[], limit = 4): TalkingPoint[] {
  const latest = months[months.length - 1];
  const previous = months[months.length - 2];
  if (!latest) return [];
  const slipped: Array<TalkingPoint & { weight: number }> = [];
  const nearly: Array<TalkingPoint & { weight: number }> = [];
  const climbed: Array<TalkingPoint & { weight: number }> = [];

  for (const row of rows) {
    if (row.kind !== "phrase") continue;
    const now = row.positions[latest];
    if (now === null || now === undefined) continue;
    const before = previous ? row.positions[previous] : undefined;
    const trend = trendBetween(before, now);
    const bandChanged = trend !== null && visibilityFor(before!) !== visibilityFor(now);
    const significant = trend !== null && (trend.places >= SIGNIFICANT_MOVE || bandChanged);

    if (trend?.direction === "down" && significant) {
      const band = bandChanged ? ` - now ${VISIBILITY_LABEL[visibilityFor(now)!].toLowerCase()}` : "";
      slipped.push({ kind: "slipped", phrase: row.label, text: `Fell from ${positionText(before!)} to ${positionText(now)}${band}`, weight: trend.places });
    } else if (now > 20 && now <= NEARLY_VISIBLE_MAX) {
      const gap = now - 20;
      nearly.push({ kind: "nearly", phrase: row.label, text: `At #${now} - ${gap} place${gap === 1 ? "" : "s"} from the top 20`, weight: -now });
    } else if (trend?.direction === "up" && significant) {
      climbed.push({ kind: "climbed", phrase: row.label, text: `Climbed from ${positionText(before!)} to ${positionText(now)}`, weight: trend.places });
    }
  }

  const byWeight = (a: { weight: number }, b: { weight: number }) => b.weight - a.weight;
  return [...slipped.sort(byWeight), ...nearly.sort(byWeight), ...climbed.sort(byWeight)]
    .slice(0, limit)
    .map(({ kind, phrase, text }) => ({ kind, phrase, text }));
}

export interface DashboardLead {
  id: string;
  status: "lead" | "client";
  last_ranking_pull: string | null;
}

/** Header numbers for the leads dashboard: lead and client counts, top-20 share and the newest pull. */
export function dashboardStats(leads: DashboardLead[], visibility: Map<string, { counts: VisibilityCounts }>) {
  let visible = 0;
  let ranked = 0;
  for (const lead of leads) {
    const counts = visibility.get(lead.id)?.counts;
    if (!counts) continue;
    visible += counts.visible;
    ranked += counts.visible + counts.partly + counts.invisible;
  }
  const lastPull = leads.reduce<string | null>((latest, l) => (l.last_ranking_pull && (!latest || l.last_ranking_pull > latest) ? l.last_ranking_pull : latest), null);
  return {
    leadCount: leads.filter((l) => l.status === "lead").length,
    clientCount: leads.filter((l) => l.status === "client").length,
    visibleShare: ranked === 0 ? null : Math.round((visible / ranked) * 100),
    lastPull,
  };
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase() || "?";
}
