import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, BadgeCheck, Building2, Eye, History, Plus, Search, SearchX, Upload, Users, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AddLeadDialog } from "@/components/AddLeadDialog";
import { ImportLeadsDialog } from "@/components/ImportLeadsDialog";
import { PullStatus } from "@/components/PullStatus";
import { StatusBadge } from "@/components/StatusBadge";
import { VisibilityBar } from "@/components/VisibilityBar";
import { Button } from "@/components/ui/button";
import { Avatar, EmptyState } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { usePullRuns } from "@/hooks/usePullRuns";
import { data } from "@/lib/data";
import { formatLongDate } from "@/lib/format";
import { dashboardStats, initials, latestVisibilityByLead, relativeTime, visibilitySinceMonth } from "@/lib/insights";
import { countByStatus, filterByStatus, filterLeads, sortLeads, withLocationLabels, type SortDirection, type SortKey, type StatusFilter } from "@/lib/leads-table";
import { STATUS_LABEL, STATUSES } from "@/lib/types";
import { cn } from "@/lib/utils";

const COLUMNS: Array<{ key: SortKey | null; label: string; className?: string }> = [
  { key: "business_name", label: "Company" },
  { key: "industry", label: "Industry" },
  { key: "location", label: "Location" },
  { key: null, label: "Visibility" },
  { key: "last_ranking_pull", label: "Last ranking update" },
  { key: "status", label: "Status" },
];

function Stat({ label, icon, value, detail, alert = false }: { label: string; icon: ReactNode; value: ReactNode; detail?: ReactNode; alert?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-5 py-4">
      <div className="flex items-start justify-between gap-2">
        <p className={cn("eyebrow", alert && "text-crimson")}>{label}</p>
        <span className={cn("[&_svg]:h-4 [&_svg]:w-4", alert ? "text-crimson" : "text-slate-400")}>{icon}</span>
      </div>
      <p className={cn("mt-2 font-display text-[36px] leading-10 tabular-nums", alert ? "text-crimson" : "text-slate-900")}>{value}</p>
      {detail ? <p className="mt-1 text-xs text-slate-500">{detail}</p> : null}
    </div>
  );
}

export function LeadsPage() {
  const navigate = useNavigate();
  const leads = useQuery({ queryKey: ["leads"], queryFn: data.leads });
  const locations = useQuery({ queryKey: ["locations"], queryFn: data.locations });
  const sinceMonth = visibilitySinceMonth(new Date());
  const cells = useQuery({ queryKey: ["rankings", "by-lead", sinceMonth], queryFn: () => data.leadRankingCells(sinceMonth) });
  const runs = usePullRuns();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({ key: "business_name", direction: "asc" });
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);

  const now = new Date();
  const labelled = useMemo(() => withLocationLabels(leads.data ?? [], locations.data ?? []), [leads.data, locations.data]);
  const visibility = useMemo(() => latestVisibilityByLead(cells.data ?? []), [cells.data]);
  const stats = useMemo(() => dashboardStats(labelled, visibility), [labelled, visibility]);
  const statusCounts = useMemo(() => countByStatus(labelled), [labelled]);
  const rows = useMemo(() => sortLeads(filterByStatus(filterLeads(labelled, query), status), sort.key, sort.direction), [labelled, query, status, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((current) => ({ key, direction: current.key === key && current.direction === "asc" ? "desc" : "asc" }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">
            Leads <span className="mx-1 text-slate-300">/</span> {formatLongDate(now)}
          </p>
          <h1 className="mt-2 font-display text-[32px] leading-10 font-medium tracking-[-0.01em] text-slate-900 sm:text-[44px] sm:leading-[52px] sm:tracking-[-0.02em]">Leads</h1>
          <p className="mt-1 max-w-xl text-sm text-slate-600">Track Google visibility for every prospect and client.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => setImporting(true)}>
            <Upload /> Import CSV
          </Button>
          <Button onClick={() => setAdding(true)}>
            <Plus /> Add new lead
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat label="Leads" icon={<Building2 />} value={stats.leadCount} detail={`of ${labelled.length} in total`} />
        <Stat label="Clients" icon={<BadgeCheck />} value={stats.clientCount} detail={`of ${labelled.length} in total`} />
        <Stat label="Visible phrases" icon={<Eye />} value={stats.visibleShare === null ? "-" : `${stats.visibleShare}%`} detail="in the top 20, latest month per lead" />
        <Stat label="Last ranking update" icon={<History />} value={relativeTime(stats.lastPull, now)} detail={stats.lastPull ? "across all leads" : "no pulls yet"} />
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Segmented
            label="Filter by status"
            value={status}
            onChange={setStatus}
            options={(["all", ...STATUSES] as const).map((s) => ({
              value: s,
              label: (
                <>
                  <span>{s === "all" ? "All" : STATUS_LABEL[s]}</span>
                  <span className="rounded-full bg-slate-200/70 px-1.5 text-[11px] text-slate-600 tabular-nums">{statusCounts[s]}</span>
                </>
              ),
            }))}
          />
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
            <Input className="pr-8 pl-9" placeholder="Search by company name" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search leads by company name" />
            {query ? (
              <button type="button" aria-label="Clear search" onClick={() => setQuery("")} className="absolute top-2 right-2 rounded p-0.5 text-slate-400 hover:text-slate-700">
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="eyebrow border-y border-b-2 border-slate-200 border-b-brand-700 bg-panel text-left text-slate-700">
                {COLUMNS.map((col) => {
                  const active = col.key !== null && sort.key === col.key;
                  const Icon = sort.direction === "asc" ? ArrowUp : ArrowDown;
                  return (
                    <th key={col.label} className="px-3.5 py-3 font-semibold whitespace-nowrap" aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : undefined}>
                      {col.key ? (
                        <button type="button" className={cn("group inline-flex items-center gap-1 tracking-[inherit] uppercase hover:text-brand-700", active && "text-brand-700")} onClick={() => toggleSort(col.key!)}>
                          {col.label}
                          <Icon className={cn("h-3 w-3 transition-opacity", active ? "opacity-100" : "opacity-0 group-hover:opacity-40")} />
                        </button>
                      ) : (
                        col.label
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {leads.isLoading
                ? [0, 1, 2].map((i) => (
                    <tr key={i}>
                      <td colSpan={COLUMNS.length} className="px-4 py-4">
                        <div className="h-5 animate-pulse rounded bg-slate-100" />
                      </td>
                    </tr>
                  ))
                : rows.map((lead) => {
                    const leadVisibility = visibility.get(lead.id);
                    const ranked = leadVisibility ? leadVisibility.counts.visible + leadVisibility.counts.partly + leadVisibility.counts.invisible : 0;
                    return (
                      <tr key={lead.id} onClick={() => navigate(`/leads/${lead.id}`)} className="group cursor-pointer transition-colors hover:bg-panel/70">
                        <td className="px-3.5 py-3">
                          <div className="flex items-center gap-3">
                            <Avatar text={initials(lead.business_name)} />
                            <div className="min-w-0">
                              <Link to={`/leads/${lead.id}`} onClick={(e) => e.stopPropagation()} className="font-display text-[16px] leading-tight font-semibold whitespace-nowrap text-slate-900 hover:underline">
                                {lead.business_name}
                              </Link>
                              <p className="truncate tabular-nums text-[11px] text-slate-500">{lead.website_domain ?? "No website"}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3.5 py-3 whitespace-nowrap text-slate-700">{lead.industry || <span className="text-slate-400">-</span>}</td>
                        <td className="px-3.5 py-3 whitespace-nowrap text-slate-700">{lead.locationLabel || <span className="text-slate-400">-</span>}</td>
                        <td className="px-3.5 py-3">
                          {runs.latest.get(lead.id)?.status === "running" ? (
                            <PullStatus run={runs.latest.get(lead.id)} />
                          ) : leadVisibility ? (
                            <div className="w-32">
                              <VisibilityBar counts={leadVisibility.counts} />
                              <p className="mt-1 text-xs text-slate-500 tabular-nums">
                                <span className="font-medium text-slate-700">{leadVisibility.counts.visible}</span> of {ranked} visible
                              </p>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">No rankings yet</span>
                          )}
                        </td>
                        <td className="px-3.5 py-3 tabular-nums text-xs whitespace-nowrap text-slate-600" title={lead.last_ranking_pull ?? undefined}>
                          <div className="flex flex-col items-start gap-1">
                            {relativeTime(lead.last_ranking_pull, now)}
                            {runs.latest.get(lead.id)?.status !== "running" ? <PullStatus run={runs.latest.get(lead.id)} /> : null}
                          </div>
                        </td>
                        <td className="px-3.5 py-3">
                          <StatusBadge status={lead.status} />
                        </td>
                      </tr>
                    );
                  })}
            </tbody>
          </table>
          {!leads.isLoading && rows.length === 0 ? (
            labelled.length === 0 ? (
              <EmptyState
                icon={<Users />}
                title="No leads yet"
                description="Add your first lead, then add key phrases to start tracking their Google visibility."
                action={
                  <Button onClick={() => setAdding(true)}>
                    <Plus /> Add lead
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={<SearchX />}
                title="No matching leads"
                description="Try a different name or status filter."
                action={
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setQuery("");
                      setStatus("all");
                    }}
                  >
                    Clear filters
                  </Button>
                }
              />
            )
          ) : null}
        </div>
      </div>

      <AddLeadDialog open={adding} onOpenChange={setAdding} locations={locations.data ?? []} />
      <ImportLeadsDialog open={importing} onOpenChange={setImporting} />
    </div>
  );
}
