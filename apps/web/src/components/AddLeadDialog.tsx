import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { normalizeDomain } from "@lvt/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { data } from "@/lib/data";
import type { LocationCode } from "@/lib/types";

// Most prospects are in the UK; the country decides which Google is checked.
const EMPTY = { business_name: "", industry: "", location_code: "UK", website_domain: "" };

export function AddLeadDialog({ open, onOpenChange, locations }: { open: boolean; onOpenChange: (open: boolean) => void; locations: LocationCode[] }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY);

  const create = useMutation({
    mutationFn: () =>
      data.createLead({
        business_name: form.business_name.trim(),
        industry: form.industry.trim() || null,
        location_code: form.location_code || null,
        website_domain: form.website_domain.trim() ? normalizeDomain(form.website_domain) : null,
      }),
    onSuccess: (lead) => {
      void queryClient.invalidateQueries({ queryKey: ["leads"] });
      toast.success(`${lead.business_name} added`);
      onOpenChange(false);
      setForm(EMPTY);
      navigate(`/leads/${lead.id}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Add a new lead"
        description="You can add contacts and key phrases on the lead page next."
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" form="add-lead-form" loading={create.isPending} disabled={!form.business_name.trim()}>
              {create.isPending ? "Adding..." : "Add lead"} <ArrowRight />
            </Button>
          </>
        }
      >
        <form id="add-lead-form" onSubmit={submit} className="space-y-4">
          <Field label="Business name" htmlFor="new-name">
            <Input id="new-name" required autoFocus placeholder="e.g. BrightClean Industrial Ltd" value={form.business_name} onChange={(e) => setForm({ ...form, business_name: e.target.value })} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Industry / category" htmlFor="new-industry">
              <Input id="new-industry" placeholder="e.g. Industrial Cleaning" value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} />
            </Field>
            <Field label="Location" htmlFor="new-location">
              <Select
                id="new-location"
                value={form.location_code || null}
                onChange={(code) => setForm({ ...form, location_code: code ?? "" })}
                emptyLabel="No location"
                options={locations.map((l) => ({ value: l.code, label: l.label, hint: l.code }))}
              />
            </Field>
          </div>
          <Field label="Website domain" htmlFor="new-domain" hint="Used to find the lead in Google results. Subdomains count too.">
            <Input id="new-domain" placeholder="example.co.uk" value={form.website_domain} onChange={(e) => setForm({ ...form, website_domain: e.target.value })} />
          </Field>
        </form>
      </DialogContent>
    </Dialog>
  );
}
