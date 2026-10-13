import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, NotebookPen, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { api } from "@/lib/api";
import { data } from "@/lib/data";
import type { Lead } from "@/lib/types";

/**
 * Zone B - the brief. The draft is owned by the page so "Copy for ChatGPT" uses what is on screen.
 * "Update brief" merges raw notes via the API; the result is only saved when Frank clicks Save.
 */
export function BriefCard({ lead, draft, onDraftChange }: { lead: Lead; draft: string; onDraftChange: (brief: string) => void }) {
  const queryClient = useQueryClient();
  const [notesOpen, setNotesOpen] = useState(false);
  const [notes, setNotes] = useState("");

  const save = useMutation({
    mutationFn: () => data.updateLead(lead.id, { brief: draft }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["lead", lead.id] });
      toast.success("Brief saved");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const merge = useMutation({
    mutationFn: () => api.mergeBrief(draft, notes),
    onSuccess: (result) => {
      onDraftChange(result.brief);
      setNotes("");
      setNotesOpen(false);
      toast.success(result.mode === "mock" ? "Notes merged (demo mode - no Claude key set). Review, then save." : "Brief updated - review, then save.");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const dirty = draft !== lead.brief;

  return (
    <Card
      title="Brief"
      icon={<NotebookPen />}
      description="Everything you know about this lead."
      actions={
        <Button size="sm" variant="secondary" onClick={() => setNotesOpen(true)}>
          <Sparkles /> Update brief
        </Button>
      }
    >
      <Textarea
        aria-label="Brief"
        rows={6}
        value={draft}
        className="field-sizing-content max-h-[32rem] min-h-36 resize-y px-4 py-3 text-[15px]"
        placeholder="Industry context, pain points, previous conversations..."
        onChange={(e) => onDraftChange(e.target.value)}
      />
      {dirty ? (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-partly/20 bg-partly-soft px-3 py-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-partly">
            <CircleAlert className="h-4 w-4" /> Unsaved changes
          </span>
          <div className="flex items-center gap-4">
            <button type="button" className="text-action text-slate-700" onClick={() => onDraftChange(lead.brief)}>
              Discard
            </button>
            <Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? "Saving..." : "Save brief"}
            </Button>
          </div>
        </div>
      ) : null}

      <Dialog open={notesOpen} onOpenChange={(open) => !merge.isPending && setNotesOpen(open)}>
        <DialogContent
          title="Update brief with notes"
          description="Paste rough notes from a call or email. They are merged into the brief, and you can review the result before saving."
          footer={
            <>
              <Button variant="secondary" disabled={merge.isPending} onClick={() => setNotesOpen(false)}>
                Cancel
              </Button>
              <Button loading={merge.isPending} disabled={!notes.trim()} onClick={() => merge.mutate()}>
                <Sparkles /> {merge.isPending ? "Merging..." : "Merge into brief"}
              </Button>
            </>
          }
        >
          <Textarea aria-label="Raw notes" rows={8} autoFocus value={notes} placeholder="- spoke to Sarah, wants more warehouse work..." onChange={(e) => setNotes(e.target.value)} />
        </DialogContent>
      </Dialog>
    </Card>
  );
}
