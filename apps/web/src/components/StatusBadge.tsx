import { Badge, type BadgeTone } from "@/components/ui/card";
import { STATUS_LABEL, type LeadStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export const STATUS_TONE: Record<LeadStatus, BadgeTone> = { lead: "neutral", client: "green" };

const DOT: Record<LeadStatus, string> = { lead: "bg-slate-400", client: "bg-visible-bar" };

export function StatusDot({ status }: { status: LeadStatus }) {
  return <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", DOT[status])} />;
}

export function StatusBadge({ status }: { status: LeadStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]}>
      <StatusDot status={status} />
      {STATUS_LABEL[status]}
    </Badge>
  );
}
