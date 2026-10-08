import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, Mail, Pencil, Plus, Trash2, UserPlus, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { copyText } from "@/lib/clipboard";
import { data, MAX_CONTACTS } from "@/lib/data";
import { initials } from "@/lib/insights";
import { joinEmails } from "@/lib/leads-table";
import type { Contact } from "@/lib/types";

const emptyContact = (): Contact => ({ name: "", job_title: "", email: "", sort_order: 0 });

async function copyWithToast(text: string, success: string) {
  try {
    await copyText(text);
    toast.success(success);
  } catch (err) {
    toast.error((err as Error).message);
  }
}

/** Zone A - up to five contacts, read-only until "Edit". */
export function ContactsCard({ leadId, contacts }: { leadId: string; contacts: Contact[] }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [people, setPeople] = useState<Contact[]>(contacts);

  const save = useMutation({
    mutationFn: () => data.saveContacts(leadId, people.filter((p) => p.name.trim() || p.email.trim())),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["contacts", leadId] });
      toast.success("Contacts saved");
      setEditing(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const startEditing = () => {
    setPeople(contacts.length ? contacts : [emptyContact()]);
    setEditing(true);
  };

  const invalidContact = people.find((p) => (p.name.trim() || p.email.trim()) && (!p.name.trim() || !/^\S+@\S+\.\S+$/.test(p.email.trim())));
  const updatePerson = (index: number, patch: Partial<Contact>) => setPeople((list) => list.map((p, i) => (i === index ? { ...p, ...patch } : p)));

  const copyAll = () => {
    const emails = joinEmails(contacts.map((c) => c.email));
    if (!emails) {
      toast.error("No saved contact emails to copy");
      return;
    }
    void copyWithToast(emails, "Emails copied - paste into Gmail");
  };

  if (editing) {
    return (
      <Card title="Contacts" description={`${people.length} of ${MAX_CONTACTS} contacts`}>
        <div className="space-y-3">
          {people.map((person, index) => (
            <div key={index} className="relative space-y-2 rounded-md border border-slate-200 bg-white p-3 pr-11">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
                <Input aria-label={`Contact ${index + 1} name`} placeholder="Name" value={person.name} onChange={(e) => updatePerson(index, { name: e.target.value })} />
                <Input aria-label={`Contact ${index + 1} job title`} placeholder="Job title" value={person.job_title ?? ""} onChange={(e) => updatePerson(index, { job_title: e.target.value })} />
              </div>
              <Input aria-label={`Contact ${index + 1} email`} type="email" placeholder="Email" value={person.email} onChange={(e) => updatePerson(index, { email: e.target.value })} />
              <Button
                size="icon"
                variant="ghost"
                className="absolute top-2 right-2 text-slate-400 hover:text-invisible"
                aria-label={`Remove contact ${index + 1}`}
                onClick={() => setPeople((list) => list.filter((_, i) => i !== index))}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button size="sm" variant="ghost" disabled={people.length >= MAX_CONTACTS} onClick={() => setPeople((list) => [...list, emptyContact()])}>
            <Plus /> Add contact
          </Button>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-4">
          {invalidContact ? <span className="mr-auto text-xs text-invisible">Each contact needs a name and a valid email</span> : null}
          <Button size="sm" variant="secondary" onClick={() => setEditing(false)} disabled={save.isPending}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending || Boolean(invalidContact)}>
            {save.isPending ? "Saving..." : "Save contacts"}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card
      title="Contacts"
      icon={<Users />}
      badge={contacts.length ? <span className="rounded bg-panel-strong px-1.5 py-0.5 tabular-nums text-[11px] text-slate-600">{contacts.length} of {MAX_CONTACTS}</span> : undefined}
      actions={
        contacts.length ? (
          <>
            <button type="button" className="text-action" onClick={copyAll} title="Copy every email, comma-separated for Gmail">
              <Copy /> Copy all emails
            </button>
            <button type="button" className="text-action" onClick={startEditing}>
              <Pencil /> Edit
            </button>
          </>
        ) : null
      }
    >
      {contacts.length === 0 ? (
        <EmptyState
          icon={<UserPlus />}
          title="No contacts yet"
          description="Add up to five people to email at this lead."
          action={
            <Button size="sm" onClick={startEditing}>
              <Plus /> Add contacts
            </Button>
          }
        />
      ) : (
        <ul className="space-y-2">
          {contacts.map((c) => (
            <li key={c.id ?? c.email} className="group flex items-center gap-3 rounded-md border border-slate-200 bg-panel/60 px-3 py-2.5">
              <span aria-hidden className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand-700 text-xs font-semibold text-white">
                {initials(c.name)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-900">{c.name}</p>
                {c.job_title ? <p className="truncate text-xs text-slate-500">{c.job_title}</p> : null}
                <a href={`mailto:${c.email}`} className="block truncate tabular-nums text-[11px] text-brand-700 hover:underline">
                  {c.email}
                </a>
              </div>
              <div className="flex text-slate-500">
                <Button size="icon" variant="ghost" aria-label={`Copy ${c.email}`} title="Copy email" onClick={() => void copyWithToast(c.email, "Email copied")}>
                  <Copy />
                </Button>
                <a
                  href={`mailto:${c.email}`}
                  aria-label={`Email ${c.name}`}
                  title="Send email"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                >
                  <Mail className="h-4 w-4" />
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
