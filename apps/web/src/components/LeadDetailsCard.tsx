import { Building2, ExternalLink, Pencil } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { normalizeDomain } from "@lvt/shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useUpdateLead } from "@/hooks/useUpdateLead";
import { formatDate } from "@/lib/format";
import { relativeTime } from "@/lib/insights";
import type { Lead, LocationCode } from "@/lib/types";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="-mx-6 flex items-baseline justify-between gap-4 px-6 py-2.5 even:bg-panel/60">
      <dt className="shrink-0 text-xs text-slate-600">{label}</dt>
      <dd className="min-w-0 truncate text-right text-xs font-medium text-slate-900">{children}</dd>
    </div>
  );
}

const muted = <span className="text-slate-400">Not set</span>;

/** Zone A - lead details, read-only until "Edit". Status lives in the page header. */
export function LeadDetailsCard({ lead, locations }: { lead: Lead; locations: LocationCode[] }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(lead);
  const save = useUpdateLead(lead.id);

  const startEditing = () => {
    setForm(lead);
    setEditing(true);
  };

  const submit = () => {
    if (!form.business_name.trim()) {
      toast.error("Business name is required");
      return;
    }
    save.mutate(
      {
        business_name: form.business_name.trim(),
        industry: form.industry?.trim() || null,
        location_code: form.location_code || null,
        website_domain: form.website_domain?.trim() ? normalizeDomain(form.website_domain) : null,
      },
      { onSuccess: () => setEditing(false) },
    );
  };

  const location = locations.find((l) => l.code === lead.location_code);

  if (editing) {
    return (
      <Card title="Lead details" description="Changes apply when you save.">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field label="Business name" htmlFor="business-name">
            <Input id="business-name" autoFocus value={form.business_name} onChange={(e) => setForm({ ...form, business_name: e.target.value })} />
          </Field>
          <Field label="Industry / category" htmlFor="industry">
            <Input id="industry" value={form.industry ?? ""} onChange={(e) => setForm({ ...form, industry: e.target.value })} />
          </Field>
          <Field label="Location" htmlFor="location" hint="The country decides which Google is checked: Google UK, Google South Africa or Google USA.">
            <Select
              id="location"
              value={form.location_code ?? null}
              onChange={(code) => setForm({ ...form, location_code: code })}
              emptyLabel="No location"
              options={locations.map((l) => ({ value: l.code, label: l.label, hint: l.code }))}
            />
          </Field>
          <Field label="Website domain" htmlFor="domain">
            <Input id="domain" placeholder="example.co.uk" value={form.website_domain ?? ""} onChange={(e) => setForm({ ...form, website_domain: e.target.value })} />
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" size="sm" onClick={() => setEditing(false)} disabled={save.isPending}>
              Cancel
            </Button>
            <Button type="submit" size="sm" loading={save.isPending}>
              {save.isPending ? "Saving..." : "Save details"}
            </Button>
          </div>
        </form>
      </Card>
    );
  }

  return (
    <Card
      title="Lead details"
      icon={<Building2 />}
      actions={
        <button type="button" className="text-action" onClick={startEditing}>
          <Pencil /> Edit
        </button>
      }
      bodyClassName="pb-3"
    >
      <dl>
        <Row label="Industry">{lead.industry || muted}</Row>
        <Row label="Location">{location ? location.label : muted}</Row>
        <Row label="Website">
          {lead.website_domain ? (
            <a href={`https://${lead.website_domain}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-600 hover:underline">
              {lead.website_domain} <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            muted
          )}
        </Row>
        <Row label="Last ranking update">{lead.last_ranking_pull ? relativeTime(lead.last_ranking_pull, new Date()) : muted}</Row>
        <Row label="Date added">
          <span className="tabular-nums text-slate-600">{formatDate(lead.date_added)}</span>
        </Row>
      </dl>
    </Card>
  );
}
