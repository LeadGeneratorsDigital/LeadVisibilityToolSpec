import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Archive, ArrowDown, ArrowUp, Check, Info, Pencil, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { data } from "@/lib/data";
import type { BuyerGroup, Phrase } from "@/lib/types";

function nextOrder(items: Array<{ sort_order: number }>): number {
  return items.reduce((max, item) => Math.max(max, item.sort_order), 0) + 1;
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
      <Input aria-label="New phrase" placeholder="Add a buyer phrase, e.g. contract cleaning services london" value={text} onChange={(e) => setText(e.target.value)} />
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

  const archivePhrase = (phrase: Phrase) =>
    confirm({
      title: "Stop tracking this phrase?",
      description: `"${phrase.phrase_text}" will no longer be pulled. Its ranking history is kept, and adding the phrase again brings it back.`,
      confirmLabel: "Stop tracking",
      onConfirm: () => run.mutate(() => data.archivePhrase(phrase.id)),
    });

  const addPhrase = (groupId: string | null, text: string, sortOrder: number) =>
    run.mutate(async () => {
      if ((await data.addPhrase(leadId, groupId, text, sortOrder)) === "restored") toast.success(`"${text}" is tracked again, with its ranking history`);
    });

  const removeGroup = (group: BuyerGroup) =>
    confirm({
      title: "Delete this buyer group?",
      description: `"${group.name}" will be deleted. Its phrases are kept as ungrouped phrases.`,
      confirmLabel: "Delete group",
      destructive: true,
      onConfirm: () => run.mutate(() => data.deleteBuyerGroup(group.id)),
    });

  const phraseList = (list: Phrase[], groupId: string | null) => (
    <>
      <ul className="divide-y divide-slate-200">
        {list.map((phrase, index) => (
          <li key={phrase.id} className="flex items-center gap-0.5 px-4 py-1.5 text-sm text-slate-800 hover:bg-panel/60">
            <span className="flex-1">{phrase.phrase_text}</span>
            <Button size="icon" variant="ghost" aria-label="Move phrase up" disabled={index === 0 || run.isPending} onClick={() => move("phrases", list, index, -1)}>
              <ArrowUp className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" aria-label="Move phrase down" disabled={index === list.length - 1 || run.isPending} onClick={() => move("phrases", list, index, 1)}>
              <ArrowDown className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" aria-label={`Stop tracking ${phrase.phrase_text}`} title="Stop tracking (history is kept)" disabled={run.isPending} onClick={() => archivePhrase(phrase)}>
              <Archive className="h-3.5 w-3.5 text-slate-500" />
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
      <DialogContent title="Manage buyer phrases" description="Organise the phrases tracked for this lead by buyer group." className="max-w-2xl">
        <div className="space-y-5">
          <p className="flex items-start gap-2 rounded-md border border-slate-200 bg-panel px-3 py-2.5 text-xs text-slate-600">
            <Info className="mt-px h-4 w-4 shrink-0" />
            Buyer groups appear as heading rows in the ranking table. New phrases get rankings on the next pull. Phrases you stop tracking keep their history.
          </p>
          {ungrouped.length > 0 ? (
            <section className="overflow-hidden rounded-md border border-slate-200">
              <h3 className="eyebrow bg-panel px-4 py-2.5">Ungrouped phrases</h3>
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
                    <Input aria-label="Group name" className="h-7 text-slate-900" autoFocus value={editing.name} onChange={(e) => setEditing({ id: group.id, name: e.target.value })} />
                    <Button type="submit" size="icon" variant="ghost" className="text-white hover:bg-white/10" aria-label="Save group name">
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
                    <Button size="icon" variant="ghost" className="text-white hover:bg-white/10" aria-label="Rename group" onClick={() => setEditing({ id: group.id, name: group.name })}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
                <Button size="icon" variant="ghost" className="text-white hover:bg-white/10" aria-label="Move group up" disabled={index === 0 || run.isPending} onClick={() => move("buyer_groups", sortedGroups, index, -1)}>
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="text-white hover:bg-white/10"
                  aria-label="Move group down"
                  disabled={index === sortedGroups.length - 1 || run.isPending}
                  onClick={() => move("buyer_groups", sortedGroups, index, 1)}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon" variant="ghost" className="text-white hover:bg-white/10" aria-label={`Delete group ${group.name}`} disabled={run.isPending} onClick={() => removeGroup(group)}>
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
            <Input aria-label="New buyer group" placeholder="New buyer group, e.g. Industrial Cleaning Contracts London" value={newGroup} onChange={(e) => setNewGroup(e.target.value)} />
            <Button type="submit" disabled={!newGroup.trim() || run.isPending}>
              <Plus className="h-4 w-4" /> Add group
            </Button>
          </form>
          {sortedGroups.length === 0 && ungrouped.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-300">
              <p className="px-4 pt-3 text-xs text-slate-500">Or add phrases without a group:</p>
              <AddPhraseForm disabled={run.isPending} onAdd={(text) => addPhrase(null, text, 1)} />
            </div>
          ) : null}
        </div>
        {confirmDialog}
      </DialogContent>
    </Dialog>
  );
}
