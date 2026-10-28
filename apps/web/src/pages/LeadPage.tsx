import { useMutation, useQuery } from "@tanstack/react-query";
import { buildRankingCsv, buildRankingGrid, currentMonthKey, historyMonths } from "@lvt/shared";
import { BarChart3, ExternalLink, FileSpreadsheet, ListTree, MapPin, RefreshCw, Tag } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ContactsCard } from "@/components/ContactsCard";
import { LeadDetailsCard } from "@/components/LeadDetailsCard";
import { PhraseManagerDialog } from "@/components/PhraseManagerDialog";
import { PullStatus } from "@/components/PullStatus";
import { RankingTable } from "@/components/RankingTable";
import { StatusDot } from "@/components/StatusBadge";
import { VisibilitySummaryCard } from "@/components/VisibilitySummaryCard";
import { Button } from "@/components/ui/button";
import { Avatar, Card, EmptyState } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Segmented } from "@/components/ui/segmented";
import { usePullRuns } from "@/hooks/usePullRuns";
import { useUpdateLead } from "@/hooks/useUpdateLead";
import { api } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { data } from "@/lib/data";
import { initials, monthUpdateState } from "@/lib/insights";
import { STATUS_LABEL, STATUSES } from "@/lib/types";
import { cn } from "@/lib/utils";

const LEGEND = [
  { label: "Visible 1-20", className: "bg-visible-bar" },
  { label: "Partly visible 21-100", className: "bg-partly-bar" },
  { label: "Not Ranked - outside the top 100", className: "bg-invisible-bar" },
  { label: "No data - the check failed", className: "border border-dashed border-slate-400" },
];

function LoadingSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-4 w-40 rounded bg-slate-200" />
      <div className="h-20 rounded-lg bg-slate-200/70" />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="h-72 rounded-lg bg-slate-200/70" />
        <div className="h-72 rounded-lg bg-slate-200/70 lg:col-span-2" />
      </div>
    </div>
  );
}

export function LeadPage() {
  const { id = "" } = useParams();
  const lead = useQuery({ queryKey: ["lead", id], queryFn: () => data.lead(id) });
  const contacts = useQuery({ queryKey: ["contacts", id], queryFn: () => data.contacts(id) });
  const locations = useQuery({ queryKey: ["locations"], queryFn: data.locations });
  const groups = useQuery({ queryKey: ["groups", id], queryFn: () => data.buyerGroups(id) });
  const phrases = useQuery({ queryKey: ["phrases", id], queryFn: () => data.phrases(id) });
  const phraseIds = useMemo(() => (phrases.data ?? []).map((p) => p.id), [phrases.data]);
  const rankings = useQuery({ queryKey: ["rankings", id, phraseIds], queryFn: () => data.rankings(phraseIds), enabled: phrases.isSuccess });
  const runs = usePullRuns(id);
  const updateStatus = useUpdateLead(id, "Status updated");
  const [managing, setManaging] = useState(false);

  const rows = useMemo(() => buildRankingGrid(groups.data ?? [], phrases.data ?? [], rankings.data ?? []), [groups.data, phrases.data, rankings.data]);
  const months = useMemo(() => historyMonths(rankings.data ?? []), [rankings.data]);
  const run = runs.latest.get(id);
  const running = run?.status === "running";

  const pull = useMutation({
    mutationFn: (force: boolean) => api.pullLead(id, { force }),
    // Returned so the button keeps spinning until the run shows as running.
    onSuccess: () => runs.refresh(),
    onError: (err: Error) => toast.error(err.message),
  });
  const busy = pull.isPending || running;

  const { confirm, dialog: confirmDialog } = useConfirm();
  // A second update in the same month replaces that month's results, so it re-checks every phrase;
  // phrases left blank by a failed check can be filled on their own, which costs only those checks.
  const thisMonth = currentMonthKey(new Date());
  const { updated: updatedThisMonth, blanks: blanksThisMonth } = monthUpdateState(rows, thisMonth);
  const updateRankings = () =>
    updatedThisMonth
      ? confirm({
          title: "Update this month's rankings again?",
          description: `Every phrase is checked on Google again and replaces this month's results. This uses DataForSEO credit for each phrase.${
            blanksThisMonth > 0 ? ` To check only the ${blanksThisMonth} phrase${blanksThisMonth === 1 ? "" : "s"} with no result this month, fill the blanks instead.` : ""
          }`,
          confirmLabel: "Update all phrases",
          onConfirm: () => pull.mutate(true),
          alternative: blanksThisMonth > 0 ? { label: `Fill ${blanksThisMonth} blank${blanksThisMonth === 1 ? "" : "s"}`, onSelect: () => pull.mutate(false) } : undefined,
        })
      : pull.mutate(false);

  if (lead.isError) {
    return (
      <EmptyState
        title="This lead could not be loaded"
        description="It may have been removed, or the connection dropped."
        action={
          <Link to="/" className="text-sm font-medium text-brand-600 hover:underline">
            Back to leads
          </Link>
        }
      />
    );
  }
  if (!lead.data || !contacts.data || !locations.data) return <LoadingSkeleton />;

  const location = locations.data.find((l) => l.code === lead.data.location_code);
  const hasPhrases = rows.some((r) => r.kind === "phrase");
  // Until rankings load (or if they fail) the table has no months, so a copy would be silently empty.
  const rankingsReady = rankings.isSuccess;

  const copyAsCsv = async () => {
    try {
      await copyText(buildRankingCsv(rows, months));
      toast.success("Copied the rankings table as CSV");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="eyebrow flex items-center gap-2">
        <Link to="/" className="hover:text-brand-700 hover:underline">
          Leads
        </Link>
        <span className="tabular-nums text-slate-300">/</span>
        <span className="truncate text-slate-900">{lead.data.business_name}</span>
      </nav>

      <header className="flex flex-col justify-between gap-5 rounded-lg border border-slate-200 bg-white p-6 lg:flex-row lg:items-center">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar text={initials(lead.data.business_name)} className="h-14 w-14 rounded-lg text-2xl" />
          <div className="min-w-0">
            <h1 className="font-display text-[30px] leading-[38px] font-semibold tracking-[-0.015em] break-words text-slate-900 sm:truncate">{lead.data.business_name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
              {lead.data.website_domain ? (
                <a href={`https://${lead.data.website_domain}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline">
                  {lead.data.website_domain} <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ) : null}
              {lead.data.industry ? (
                <span className="inline-flex items-center gap-1">
                  <Tag className="h-3.5 w-3.5" /> {lead.data.industry}
                </span>
              ) : null}
              {location ? (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" /> {location.label}
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Status"
            size="sm"
            value={lead.data.status}
            disabled={updateStatus.isPending}
            onChange={(status) => updateStatus.mutate({ status })}
            options={STATUSES.map((s) => ({
              value: s,
              label: (
                <>
                  <StatusDot status={s} /> {STATUS_LABEL[s]}
                </>
              ),
            }))}
          />
          <Button variant="secondary" onClick={() => void copyAsCsv()} disabled={!hasPhrases || !rankingsReady} title="Copy the full rankings table as CSV, ready to paste into Claude or a spreadsheet">
            <FileSpreadsheet /> Copy as CSV
          </Button>
        </div>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-4">
          <LeadDetailsCard lead={lead.data} locations={locations.data} />
          <ContactsCard key={contacts.dataUpdatedAt} leadId={id} contacts={contacts.data} />
        </div>
        <div className="space-y-6 lg:col-span-8">
          {hasPhrases ? <VisibilitySummaryCard rows={rows} months={months} /> : null}
        </div>
      </div>

      <Card
        title="Ranking history"
        icon={<BarChart3 />}
        badge={<PullStatus run={run} showSuccess />}
        description={`Google position for each key phrase, month by month (desktop${location ? `, ${location.label}` : ""}).`}
        actions={
          <>
            <Button size="sm" variant="secondary" onClick={() => setManaging(true)}>
              <ListTree /> Manage key phrases
            </Button>
            <Button size="sm" onClick={updateRankings} loading={busy} disabled={busy || !hasPhrases || !rankingsReady} title="Check every phrase on Google now and save the results under this month">
              <RefreshCw /> {busy ? "Updating..." : "Update rankings"}
            </Button>
          </>
        }
      >
        {hasPhrases ? (
          <>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md bg-panel px-4 py-2.5">
              <div className="flex flex-wrap gap-x-6 gap-y-2 text-[11px] font-semibold text-slate-700">
                {LEGEND.map((l) => (
                  <span key={l.label} className="inline-flex items-center gap-2">
                    <span className={cn("h-3 w-3 rounded-sm", l.className)} />
                    {l.label}
                  </span>
                ))}
              </div>
              <span className="hidden tabular-nums text-[11px] text-slate-500 lg:block">Most recent month at the right - hover a cell for the check date</span>
            </div>
            <RankingTable rows={rows} months={months} />
          </>
        ) : (
          <EmptyState
            icon={<BarChart3 />}
            title="No key phrases yet"
            description="Add the phrases this lead's customers search for, then update rankings to see where they appear on Google."
            action={
              <Button onClick={() => setManaging(true)}>
                <ListTree /> Add key phrases
              </Button>
            }
          />
        )}
      </Card>

      <PhraseManagerDialog open={managing} onOpenChange={setManaging} leadId={id} groups={groups.data ?? []} phrases={phrases.data ?? []} />
      {confirmDialog}
    </div>
  );
}
