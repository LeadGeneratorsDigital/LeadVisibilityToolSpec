import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Check, ClipboardList, Info, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { field, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { data } from "@/lib/data";
import { planPhraseMove } from "@/lib/phrase-move";
import { planPhrasePaste } from "@/lib/phrase-paste";
import type { BuyerGroup, Phrase } from "@/lib/types";

function nextOrder(items: Array<{ sort_order: number }>): number {
  return items.reduce((max, item) => Math.max(max, item.sort_order), 0) + 1;
}

const PASTE_EXAMPLE = "WHAT BUYERS SEARCH FOR\nart restorer london\npainting restoration\nQuestions:\nhow to restore an oil painting";

/** Paste a whole list at once; headings are lines ending in ":" or written in capitals. */
function PasteList({ groups, phrases, disabled, onSave }: { groups: BuyerGroup[]; phrases: Phrase[]; disabled: boolean; onSave: (plan: ReturnType<typeof planPhrasePaste>, done: () => void) => void }) {
  const [text, setText] = useState("");
  const plan = useMemo(() => planPhrasePaste(text, { headings: groups.map((g) => g.name), phrases: phrases.map((p) => p.phrase_text) }), [text, groups, phrases]);
  const skipped = plan.lines.filter((l) => l.kind === "phrase" && l.skip).length;
  return (
    <section className="space-y-3 rounded-md border border-slate-200 p-4">
      <p className="text-xs text-slate-600">
        One key phrase per line. A line ending in <span className="font-mono">:</span> or written in CAPITALS becomes a heading for the phrases below it; an existing heading with the same name is reused.
      </p>
      <textarea
        aria-label="Paste key phrases"
        className={`${field} min-h-40 w-full py-2 font-mono text-xs leading-5`}
        placeholder={PASTE_EXAMPLE}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {plan.lines.length > 0 ? (
        <div className="max-h-56 overflow-y-auto rounded-md bg-panel px-3 py-2 text-xs" aria-label="Preview">
          {plan.lines.map((line, i) =>
            line.kind === "heading" ? (
              <p key={i} className="mt-2 font-semibold tracking-[0.04em] text-slate-900 uppercase first:mt-0">
                {line.name} <span className="font-normal tracking-normal text-slate-500 normal-case">{line.existing ? "(existing heading)" : "(new heading)"}</span>
              </p>
            ) : (
              <p key={i} className={line.skip ? "pl-3 text-slate-400" : "pl-3 text-slate-800"}>
                <span className={line.skip ? "line-through" : undefined}>{line.text}</span>
                {line.skip ? <span className="ml-2 italic">{line.skip === "tracked" ? "already tracked" : "repeated"}</span> : null}
              </p>
            ),
          )}
        </div>
      ) : null}
      <div className="flex items-center justify-end gap-3">
        {skipped > 0 ? <span className="mr-auto text-xs text-slate-500">{skipped} skipped</span> : null}
        <Button size="sm" disabled={disabled || (plan.phrasesToAdd === 0 && plan.newHeadings.length === 0)} onClick={() => onSave(plan, () => setText(""))}>
          <Plus className="h-3.5 w-3.5" /> Add {plan.phrasesToAdd} phrase{plan.phrasesToAdd === 1 ? "" : "s"}
          {plan.newHeadings.length > 0 ? ` and ${plan.newHeadings.length} heading${plan.newHeadings.length === 1 ? "" : "s"}` : ""}
        </Button>
      </div>
    </section>
  );
}

function AddPhraseForm({ onAdd, disabled }: { onAdd: (text: string) => void; disabled: boolean }) {
  const [text, setText] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    onAdd(text.trim());
    setText("");
  };
  return (
    <form onSubmit={submit} className="flex gap-2 border-t border-slate-200 px-4 py-3">
      <Input aria-label="New phrase" placeholder="Add a key phrase, e.g. contract cleaning services london" value={text} onChange={(e) => setText(e.target.value)} />
      <Button type="submit" size="sm" variant="secondary" disabled={disabled || !text.trim()}>
        <Plus className="h-3.5 w-3.5" /> Add
      </Button>
    </form>
  );
}

export function PhraseManagerDialog({
  open,
  onOpenChange,
  leadId,
  groups,
  phrases,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  groups: BuyerGroup[];
  phrases: Phrase[];
}) {
  const queryClient = useQueryClient();
  const [newGroup, setNewGroup] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [pasting, setPasting] = useState(false);

  const run = useMutation({
    mutationFn: (action: () => Promise<void>) => action(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["groups", leadId] });
      void queryClient.invalidateQueries({ queryKey: ["phrases", leadId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const sortedGroups = [...groups].sort((a, b) => a.sort_order - b.sort_order);
  const phrasesIn = (groupId: string | null) =>
    phrases.filter((p) => (groupId === null ? p.buyer_group_id === null : p.buyer_group_id === groupId)).sort((a, b) => a.sort_order - b.sort_order);

  const move = <T extends { id: string; sort_order: number }>(table: "buyer_groups" | "phrases", list: T[], index: number, delta: -1 | 1) => {
    const a = list[index];
    const b = list[index + delta];
    if (!a || !b) return;
    const [first, second] = a.sort_order === b.sort_order ? [{ ...a, sort_order: index + 1 }, { ...b, sort_order: index + 1 + delta }] : [a, b];
    run.mutate(() => data.swapSortOrder(table, first, second));
  };

  const { confirm, dialog: confirmDialog } = useConfirm();

  const deletePhrase = (phrase: Phrase) =>
    confirm({
      title: "Delete this key phrase?",
      description: `"${phrase.phrase_text}" and all its ranking history will be deleted. This cannot be undone.`,
      confirmLabel: "Delete phrase",
      destructive: true,
      onConfirm: () => run.mutate(() => data.deletePhrase(phrase.id)),
    });

  const savePastedList = (plan: ReturnType<typeof planPhrasePaste>, done: () => void) =>
    run.mutate(async () => {
      const added = await data.addPhraseList(leadId, plan, groups, phrases);
      toast.success(`Added ${added} key phrase${added === 1 ? "" : "s"}${plan.newHeadings.length ? ` and ${plan.newHeadings.length} heading${plan.newHeadings.length === 1 ? "" : "s"}` : ""}`);
      done();
      setPasting(false);
    });

  const addPhrase = (groupId: string | null, text: string, sortOrder: number) =>
    run.mutate(async () => {
      if ((await data.addPhrase(leadId, groupId, text, sortOrder)) === "restored") toast.success(`"${text}" is tracked again, with its ranking history`);
    });

  const movePhrase = (phrase: Phrase, target: string | null) => {
    const plan = planPhraseMove(phrases, phrase.id, target);
    if (plan) run.mutate(() => data.movePhrase(phrase.id, plan.buyerGroupId, plan.sortOrder));
  };
  const headingOptions = sortedGroups.map((g) => ({ value: g.id, label: g.name }));

  const removeGroup = (group: BuyerGroup) =>
    confirm({
      title: "Delete this heading?",
      description: `"${group.name}" will be deleted. Its phrases are kept, with no heading.`,
      confirmLabel: "Delete heading",
      destructive: true,
      onConfirm: () => run.mutate(() => data.deleteBuyerGroup(group.id)),
    });

  const phraseList = (list: Phrase[], groupId: string | null) => (
    <>
      <ul className="divide-y divide-slate-200">
        {list.map((phrase, index) => (
          <li key={phrase.id} className="flex items-center gap-0.5 px-4 py-1.5 text-sm text-slate-800 hover:bg-panel/60">
            <span className="flex-1">{phrase.phrase_text}</span>
            {headingOptions.length > 0 ? (
              <Select
                ariaLabel={`Heading for ${phrase.phrase_text}`}
                className="mr-1 h-8 w-44 py-1 text-xs"
                value={groupId}
                onChange={(target) => movePhrase(phrase, target)}
                emptyLabel="No heading"
                options={headingOptions}
              />
            ) : null}
            <Button size="icon" variant="ghost" aria-label="Move phrase up" disabled={index === 0 || run.isPending} onClick={() => move("phrases", list, index, -1)}>
              <ArrowUp className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" aria-label="Move phrase down" disabled={index === list.length - 1 || run.isPending} onClick={() => move("phrases", list, index, 1)}>
              <ArrowDown className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" aria-label={`Delete ${phrase.phrase_text}`} title="Delete phrase" disabled={run.isPending} onClick={() => deletePhrase(phrase)}>
              <Trash2 className="h-3.5 w-3.5 text-slate-500" />
            </Button>
          </li>
        ))}
      </ul>
      <AddPhraseForm disabled={run.isPending} onAdd={(text) => addPhrase(groupId, text, nextOrder(list))} />
    </>
  );

  const ungrouped = phrasesIn(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Manage key phrases" description="Organise the phrases tracked for this lead under your own headings." className="max-w-2xl">
        <div className="space-y-5">
          <p className="flex items-start gap-2 rounded-md border border-slate-200 bg-panel px-3 py-2.5 text-xs text-slate-600">
            <Info className="mt-px h-4 w-4 shrink-0" />
            Headings appear as heading rows in the ranking table. Use the box next to a phrase to move it under another heading; its ranking history moves with it. New phrases get rankings on the next update.
          </p>
          <div className="flex justify-end">
            <Button size="sm" variant="secondary" onClick={() => setPasting((p) => !p)} aria-expanded={pasting}>
              <ClipboardList className="h-3.5 w-3.5" /> {pasting ? "Close list" : "Paste a list"}
            </Button>
          </div>
          {pasting ? <PasteList groups={groups} phrases={phrases} disabled={run.isPending} onSave={savePastedList} /> : null}
          {ungrouped.length > 0 ? (
            <section className="overflow-hidden rounded-md border border-slate-200">
              <h3 className="eyebrow bg-panel px-4 py-2.5">No heading</h3>
              {phraseList(ungrouped, null)}
            </section>
          ) : null}

          {sortedGroups.map((group, index) => (
            <section key={group.id} className="overflow-hidden rounded-md border border-slate-200">
              <div className="flex items-center gap-0.5 bg-brand-900 py-1.5 pr-1.5 pl-4 text-white">
                {editing?.id === group.id ? (
                  <form
                    className="flex flex-1 gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (editing.name.trim()) run.mutate(() => data.renameBuyerGroup(group.id, editing.name.trim()));
                      setEditing(null);
                    }}
                  >
                    <Input aria-label="Heading name" className="h-7 text-slate-900" autoFocus value={editing.name} onChange={(e) => setEditing({ id: group.id, name: e.target.value })} />
                    <Button type="submit" size="icon" variant="ghost" className="text-white hover:bg-white/10" aria-label="Save heading name">
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                  </form>
                ) : (
                  <>
                    <span className="flex flex-1 items-center gap-3 text-[11px] font-semibold tracking-[0.06em] uppercase">
                      {group.name}
                      <span className="rounded-sm bg-white/10 px-1.5 py-px tabular-nums font-normal tracking-normal normal-case">
                        {phrasesIn(group.id).length} phrase{phrasesIn(group.id).length === 1 ? "" : "s"}
                      </span>
                    </span>
                    <Button size="icon" variant="ghost" className="text-white hover:bg-white/10" aria-label="Rename heading" onClick={() => setEditing({ id: group.id, name: group.name })}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
                <Button size="icon" variant="ghost" className="text-white hover:bg-white/10" aria-label="Move heading up" disabled={index === 0 || run.isPending} onClick={() => move("buyer_groups", sortedGroups, index, -1)}>
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="text-white hover:bg-white/10"
                  aria-label="Move heading down"
                  disabled={index === sortedGroups.length - 1 || run.isPending}
                  onClick={() => move("buyer_groups", sortedGroups, index, 1)}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon" variant="ghost" className="text-white hover:bg-white/10" aria-label={`Delete heading ${group.name}`} disabled={run.isPending} onClick={() => removeGroup(group)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              {phraseList(phrasesIn(group.id), group.id)}
            </section>
          ))}

          <form
            className="flex gap-2 border-t border-slate-200 pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newGroup.trim()) return;
              run.mutate(() => data.addBuyerGroup(leadId, newGroup.trim(), nextOrder(groups)));
              setNewGroup("");
            }}
          >
            <Input aria-label="New heading" placeholder="New heading, e.g. Industrial Cleaning Contracts London" value={newGroup} onChange={(e) => setNewGroup(e.target.value)} />
            <Button type="submit" disabled={!newGroup.trim() || run.isPending}>
              <Plus className="h-4 w-4" /> Add heading
            </Button>
          </form>
          {sortedGroups.length === 0 && ungrouped.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-300">
              <p className="px-4 pt-3 text-xs text-slate-500">Or add phrases without a heading:</p>
              <AddPhraseForm disabled={run.isPending} onAdd={(text) => addPhrase(null, text, 1)} />
            </div>
          ) : null}
        </div>
        {confirmDialog}
      </DialogContent>
    </Dialog>
  );
}
