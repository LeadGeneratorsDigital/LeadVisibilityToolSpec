import { formatMonthHeader, type GridRow, type MonthKey } from "@lvt/shared";
import { Crosshair, Eye, TrendingDown, TrendingUp } from "lucide-react";
import { VisibilityBar } from "@/components/VisibilityBar";
import { Card } from "@/components/ui/card";
import { rankingSummary, talkingPoints, type TalkingPointKind } from "@/lib/insights";
import { cn } from "@/lib/utils";

const TILES = [
  { key: "visible", label: "Visible", range: "Top 20", className: "text-visible", chip: "bg-visible-soft text-visible" },
  { key: "partly", label: "Partly visible", range: "21-100", className: "text-partly", chip: "bg-partly-soft text-partly" },
  { key: "invisible", label: "Invisible", range: "Not Ranked", className: "text-invisible", chip: "bg-invisible-soft text-invisible" },
] as const;

const POINT_STYLE: Record<TalkingPointKind, { icon: typeof TrendingUp; className: string; textClassName: string; label: string }> = {
  slipped: { icon: TrendingDown, className: "bg-invisible-soft text-invisible", textClassName: "text-invisible", label: "Slipped" },
  nearly: { icon: Crosshair, className: "bg-partly-soft text-partly", textClassName: "text-partly", label: "Quick win" },
  climbed: { icon: TrendingUp, className: "bg-visible-soft text-visible", textClassName: "text-visible", label: "Climbed" },
};

export function VisibilitySummaryCard({ rows, months }: { rows: GridRow[]; months: MonthKey[] }) {
  const summary = rankingSummary(rows, months);
  const points = talkingPoints(rows, months);
  const previous = months[months.length - 2];

  return (
    <Card
      title="Search visibility"
      icon={<Eye />}
      description={summary.latest ? `${summary.total} key phrases, ${formatMonthHeader(summary.latest)}` : "No rankings yet"}
      actions={
        previous && summary.latest ? (
          <div className="flex items-center gap-3 text-[13px]">
            <span className="inline-flex items-center gap-1 text-visible" title={`Phrases that moved up since ${formatMonthHeader(previous)}`}>
              <TrendingUp className="h-4 w-4" /> {summary.improved} up
            </span>
            <span className="inline-flex items-center gap-1 text-invisible" title={`Phrases that moved down since ${formatMonthHeader(previous)}`}>
              <TrendingDown className="h-4 w-4" /> {summary.dropped} down
            </span>
          </div>
        ) : null
      }
    >
      <div className="grid grid-cols-3 gap-3">
        {TILES.map((t) => {
          const count = summary.counts[t.key];
          return (
            <div key={t.key} className="rounded-md border border-slate-200 bg-panel/60 px-3 py-3 sm:px-4">
              <div className="flex flex-wrap items-center justify-between gap-1">
                <span className="eyebrow truncate text-slate-700">{t.label}</span>
                <span className={cn("hidden rounded-sm px-1.5 py-px tabular-nums text-[10px] sm:inline", t.chip)}>{t.range}</span>
              </div>
              <p className={cn("mt-1 font-display text-[36px] leading-10 tabular-nums", t.className)}>{count}</p>
              <p className="tabular-nums text-[11px] text-slate-500">{summary.total ? `${Math.round((count / summary.total) * 100)}% share` : "-"}</p>
            </div>
          );
        })}
      </div>
      <VisibilityBar counts={summary.counts} className="mt-4 h-2" />
      {summary.latest && summary.counts.noData > 0 ? <p className="mt-2 text-xs text-slate-500">{summary.counts.noData} phrase(s) have no result for {formatMonthHeader(summary.latest)}.</p> : null}

      {points.length > 0 ? (
        <div className="mt-5 border-t border-slate-200 pt-4">
          <p className="eyebrow flex items-center gap-2 text-slate-700">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-brand-700" />
            Talking points for the next call
          </p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {points.map((point) => {
              const style = POINT_STYLE[point.kind];
              const Icon = style.icon;
              return (
                <li key={point.phrase} className="flex items-start gap-3 rounded-md bg-panel px-3 py-2.5">
                  <span className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md", style.className)} title={style.label}>
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900" title={point.phrase}>
                      &ldquo;{point.phrase}&rdquo;
                    </p>
                    <p className={cn("tabular-nums text-[11px]", style.textClassName)}>
                      <span className="sr-only">{style.label}: </span>
                      {point.text}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
