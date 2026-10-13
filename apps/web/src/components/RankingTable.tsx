import { formatMonthHeader, NOT_RANKED_POSITION, VISIBILITY_LABEL, visibilityFor, type GridRow, type MonthKey } from "@lvt/shared";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { checkedSuffix } from "@/lib/format";
import { trendBetween } from "@/lib/insights";
import { cn } from "@/lib/utils";

const CELL_STYLE = {
  visible: "bg-visible-soft text-visible",
  partly: "bg-partly-soft text-partly",
  invisible: "bg-invisible-soft text-invisible",
} as const;

const SHORT_LABEL = { visible: "Visible", partly: "Partly vis.", invisible: "Invisible" } as const;

function Cell({ position, previous, latest, checkedAt }: { position: number | null | undefined; previous: number | null | undefined; latest: boolean; checkedAt: string | null | undefined }) {
  if (position === null || position === undefined) {
    return (
      <td className={cn("p-1.5", latest && "bg-panel/70")} aria-label="No data">
        <div className="flex h-11 items-center justify-center rounded border border-dashed border-slate-300 font-mono text-xs text-slate-400">-</div>
      </td>
    );
  }
  const visibility = visibilityFor(position)!;
  const notRanked = position === NOT_RANKED_POSITION;
  const trend = trendBetween(previous, position);
  const title = `${VISIBILITY_LABEL[visibility]} - ${notRanked ? "not in the top 100" : `position ${position}`}${trend && trend.direction !== "same" ? ` (${trend.direction} ${trend.places})` : ""}${checkedSuffix(checkedAt)}`;
  return (
    <td className={cn("p-1.5", latest && "bg-panel/70")} title={title}>
      <div className={cn("relative flex h-11 flex-col items-center justify-center rounded", CELL_STYLE[visibility], latest && "ring-1 ring-current/25")}>
        <span className="font-mono text-[15px] leading-none font-bold tabular-nums">{notRanked ? ">100" : position}</span>
        <span className="mt-1 text-[10px] leading-none font-medium">{SHORT_LABEL[visibility]}</span>
        {trend && trend.direction !== "same" ? (
          <span className={cn("absolute top-1 right-1", trend.direction === "up" ? "text-visible-bar" : "text-invisible-bar")}>
            {trend.direction === "up" ? <ArrowUp className="h-2.5 w-2.5" strokeWidth={3} /> : <ArrowDown className="h-2.5 w-2.5" strokeWidth={3} />}
          </span>
        ) : null}
      </div>
    </td>
  );
}

/** Zone C table - phrases as rows, months as columns with the latest at the right; buyer groups as dark heading rows. */
export function RankingTable({ rows, months }: { rows: GridRow[]; months: MonthKey[] }) {
  const scroller = useRef<HTMLDivElement>(null);
  const latestMonth = months[months.length - 1];

  // Spec section 4.2: the latest month sits at the right-hand edge, so open scrolled fully right.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [latestMonth, rows.length]);

  let groupNumber = 0;
  const phraseCounts = new Map<string, number>();
  let currentHeading: string | null = null;
  for (const row of rows) {
    if (row.kind === "heading") currentHeading = row.key;
    else if (currentHeading) phraseCounts.set(currentHeading, (phraseCounts.get(currentHeading) ?? 0) + 1);
  }

  return (
    <div ref={scroller} className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr className="eyebrow text-slate-700">
            <th className="sticky left-0 z-10 min-w-64 border-b-2 border-brand-700 bg-white px-3 py-3 text-left font-semibold">Buyer phrase</th>
            {months.map((m) => (
              <th key={m} className={cn("min-w-24 border-b-2 border-brand-700 px-1.5 py-3 text-center font-semibold", m === latestMonth ? "bg-panel text-slate-900" : "bg-white")}>
                <span className="inline-flex items-center gap-1.5">
                  {formatMonthHeader(m)}
                  {m === latestMonth ? <span className="rounded-sm bg-brand-700 px-1.5 py-px text-[9px] tracking-normal text-white normal-case">Latest</span> : null}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) =>
            row.kind === "heading" ? (
              <tr key={row.key}>
                <td colSpan={months.length + 1} className="bg-brand-900 px-3 py-2 text-[11px] font-semibold tracking-[0.06em] text-white uppercase">
                  {/* The cell spans every month, so only the label can stay pinned while scrolled right. */}
                  <span className="sticky left-3">
                    Group {String(++groupNumber).padStart(2, "0")}: {row.label}
                    <span className="ml-3 font-normal tabular-nums tracking-normal text-white/60 normal-case">
                      {phraseCounts.get(row.key) ?? 0} phrase{phraseCounts.get(row.key) === 1 ? "" : "s"}
                    </span>
                  </span>
                </td>
              </tr>
            ) : (
              <tr key={row.key} className="group">
                <td className="sticky left-0 z-10 border-b border-slate-100 bg-white px-3 py-1.5 font-medium text-slate-800 group-hover:bg-panel">{row.label}</td>
                {months.map((m, i) => (
                  <Cell key={m} position={row.positions[m]} previous={i > 0 ? row.positions[months[i - 1]!] : undefined} latest={m === latestMonth} checkedAt={row.checkedAt[m]} />
                ))}
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}
