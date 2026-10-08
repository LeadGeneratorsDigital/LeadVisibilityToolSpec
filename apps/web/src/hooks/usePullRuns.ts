import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { data } from "@/lib/data";
import { latestRunByLead } from "@/lib/leads-table";

const POLL_MS = 1500;

/**
 * Latest pull run per lead. Polls while any run is still running; when a run finishes, the
 * lead and ranking queries are refreshed so the new month appears.
 */
export function usePullRuns(leadId?: string) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["pull-runs", leadId ?? "all"],
    queryFn: () => data.latestRuns(leadId),
    // Each poll yields a new array, so `latest` is recomputed against the current time and an abandoned run stops polling.
    structuralSharing: false,
    refetchInterval: (q) => ([...latestRunByLead(q.state.data ?? []).values()].some((r) => r.status === "running") ? POLL_MS : false),
  });

  const latest = useMemo(() => latestRunByLead(query.data ?? []), [query.data]);
  const anyRunning = [...latest.values()].some((r) => r.status === "running");

  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !anyRunning) {
      void queryClient.invalidateQueries({ queryKey: ["leads"] });
      void queryClient.invalidateQueries({ queryKey: ["lead"] });
      void queryClient.invalidateQueries({ queryKey: ["rankings"] });
    }
    wasRunning.current = anyRunning;
  }, [anyRunning, queryClient]);

  return { latest, anyRunning, refresh: () => queryClient.invalidateQueries({ queryKey: ["pull-runs"] }) };
}
