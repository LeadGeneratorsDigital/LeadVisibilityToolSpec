import type { VisibilityCounts } from "@/lib/insights";
import { cn } from "@/lib/utils";

const SEGMENTS = [
  { key: "visible", className: "bg-visible-bar", label: "visible" },
  { key: "partly", className: "bg-partly-bar", label: "partly visible" },
  { key: "invisible", className: "bg-invisible-bar", label: "invisible" },
  { key: "noData", className: "bg-slate-200", label: "no data" },
] as const;

export function describeCounts(counts: VisibilityCounts): string {
  return SEGMENTS.filter((s) => counts[s.key] > 0)
    .map((s) => `${counts[s.key]} ${s.label}`)
    .join(", ");
}

/** Stacked bar of phrase counts per visibility band. */
export function VisibilityBar({ counts, className }: { counts: VisibilityCounts; className?: string }) {
  const total = counts.visible + counts.partly + counts.invisible + counts.noData;
  if (total === 0) return <div className={cn("h-1.5 rounded-full bg-slate-100", className)} />;
  return (
    <div role="img" aria-label={describeCounts(counts)} title={describeCounts(counts)} className={cn("flex h-1.5 gap-px overflow-hidden rounded-full bg-slate-100", className)}>
      {SEGMENTS.map((s) =>
        counts[s.key] > 0 ? <span key={s.key} className={s.className} style={{ width: `${(counts[s.key] / total) * 100}%` }} /> : null,
      )}
    </div>
  );
}
