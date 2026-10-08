import { NOT_RANKED_POSITION, VISIBILITY_LABEL, visibilityFor, type GridRow, type MonthKey } from "@lvt/shared";
import { formatDate } from "./format";

const DAY_MS = 24 * 60 * 60 * 1000;

export type DueTone = "overdue" | "today" | "soon" | "later" | "none";

function dayNumber(isoDate: string): number {
  const [y, m, d] = isoDate.slice(0, 10).split("-").map(Number);
  return Math.round(Date.UTC(y!, m! - 1, d!) / DAY_MS);
}

/** Local calendar date as YYYY-MM-DD. */
export function todayKey(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** "Soon" covers the coming week, matching the dashboard's "due this week" card. */
export const DUE_SOON_DAYS = 7;

export function dueStatus(date: string | null, today: string): { tone: DueTone; label: string } {
  if (!date) return { tone: "none", label: "Not set" };
  const diff = dayNumber(date) - dayNumber(today);
  if (diff < 0) return { tone: "overdue", label: diff === -1 ? "Overdue 1 day" : `Overdue ${-diff} days` };
  if (diff === 0) return { tone: "today", label: "Due today" };
  if (diff === 1) return { tone: "soon", label: "Tomorrow" };
  if (diff <= DUE_SOON_DAYS) return { tone: "soon", label: `In ${diff} days` };
  return { tone: "later", label: formatDate(date) };
}

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
  status: "active" | "paused" | "converted";
  next_email_due: string | null;
  last_ranking_pull: string | null;
}

/** Header numbers for the leads dashboard. Follow-ups and visibility only count active leads. */
export function dashboardStats(leads: DashboardLead[], visibility: Map<string, { counts: VisibilityCounts }>, today: string) {
  const active = leads.filter((l) => l.status === "active");
  let overdue = 0;
  let dueSoon = 0;
  for (const lead of active) {
    const tone = dueStatus(lead.next_email_due, today).tone;
    if (tone === "overdue") overdue++;
    if (tone === "today" || tone === "soon") dueSoon++;
  }
  let visible = 0;
  let ranked = 0;
  for (const lead of active) {
    const counts = visibility.get(lead.id)?.counts;
    if (!counts) continue;
    visible += counts.visible;
    ranked += counts.visible + counts.partly + counts.invisible;
  }
  const lastPull = leads.reduce<string | null>((latest, l) => (l.last_ranking_pull && (!latest || l.last_ranking_pull > latest) ? l.last_ranking_pull : latest), null);
  return {
    activeCount: active.length,
    totalCount: leads.length,
    overdue,
    dueSoon,
    visibleShare: ranked === 0 ? null : Math.round((visible / ranked) * 100),
    lastPull,
  };
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase() || "?";
}
