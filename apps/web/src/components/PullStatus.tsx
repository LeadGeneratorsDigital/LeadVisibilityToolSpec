import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/card";
import type { PullRun } from "@/lib/types";

/** Spinner + progress while running; error badge when the latest pull failed; warning when some phrases came back blank. */
export function PullStatus({ run, showSuccess = false }: { run: PullRun | undefined; showSuccess?: boolean }) {
  if (!run) return null;
  if (run.status === "running") {
    return (
      <Badge tone="blue">
        <Loader2 className="animate-spin" aria-hidden />
        <span>
          Pulling {run.phrases_done}/{run.phrases_total}
        </span>
      </Badge>
    );
  }
  if (run.status === "failed") {
    return (
      <Badge tone="red" title={run.error ?? undefined} className="max-w-72">
        <AlertTriangle aria-hidden />
        <span className="truncate">Update failed{run.error ? `: ${run.error}` : ""}</span>
      </Badge>
    );
  }
  if (run.phrases_failed > 0) {
    return (
      <Badge tone="amber" title="Some phrases errored and were left blank. Update again to fill them.">
        <AlertTriangle aria-hidden />
        <span>{run.phrases_failed} blank - update again</span>
      </Badge>
    );
  }
  return showSuccess ? (
    <Badge tone="green">
      <CheckCircle2 aria-hidden /> Up to date
    </Badge>
  ) : null;
}
