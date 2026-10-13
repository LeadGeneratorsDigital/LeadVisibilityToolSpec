import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, FileUp, Upload } from "lucide-react";
import { useMemo, useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, type BadgeTone } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { planImportFile, runImport } from "@/lib/import-file";
import { IMPORT_TEMPLATE, importSummary, type ImportPlan, type ImportRowStatus } from "@/lib/lead-import";
import { cn } from "@/lib/utils";

type Filter = "all" | ImportRowStatus;

const STATUS: Record<ImportRowStatus, { label: string; tone: BadgeTone; row: string }> = {
  ready: { label: "Ready", tone: "green", row: "" },
  duplicate: { label: "Duplicate", tone: "amber", row: "bg-partly-soft/40" },
  error: { label: "Error", tone: "red", row: "bg-invisible-soft/40" },
};

function downloadTemplate() {
  const url = URL.createObjectURL(new Blob([IMPORT_TEMPLATE], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "leads-import-template.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export function ImportLeadsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [dragging, setDragging] = useState(false);

  const [checking, setChecking] = useState(false);
  const latestRead = useRef(0);

  const reset = () => {
    latestRead.current++;
    setFileName(null);
    setPlan(null);
    setFileError(null);
    setFilter("all");
    setChecking(false);
  };

  const close = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const readFile = async (file: File) => {
    reset();
    const read = latestRead.current;
    setFileName(file.name);
    setChecking(true);
    try {
      const result = await planImportFile(file);
      if (read === latestRead.current) setPlan(result);
    } catch (err) {
      if (read === latestRead.current) setFileError((err as Error).message);
    } finally {
      if (read === latestRead.current) setChecking(false);
    }
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file && !run.isPending) void readFile(file);
  };

  const run = useMutation({
    mutationFn: () => runImport(plan!, queryClient),
    onSuccess: (count) => {
      toast.success(`Imported ${count} lead${count === 1 ? "" : "s"}`);
      close(false);
    },
    onError: (err: Error) => toast.error(`Nothing was imported: ${err.message}`),
  });

  const summary = plan ? importSummary(plan) : null;
  const rows = useMemo(() => (plan ? plan.rows.filter((r) => filter === "all" || r.status === filter) : []), [plan, filter]);
  const width = plan ? Math.max(plan.headers.length, ...plan.rows.map((r) => r.cells.length)) : 0;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        className="max-w-6xl"
        title="Import leads from CSV"
        description="One row per contact. Rows with the same business name become one lead with up to five contacts."
        footer={
          <>
            {summary ? (
              <span className="mr-auto text-xs text-slate-600">
                {summary.leads} lead{summary.leads === 1 ? "" : "s"} and {summary.contacts} contact{summary.contacts === 1 ? "" : "s"} will be imported
                {summary.duplicate + summary.error > 0 ? `; ${summary.duplicate + summary.error} row${summary.duplicate + summary.error === 1 ? "" : "s"} skipped` : ""}
              </span>
            ) : null}
            <Button variant="ghost" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button onClick={() => run.mutate()} loading={run.isPending} disabled={!summary || summary.leads === 0}>
              <Upload /> {run.isPending ? "Importing..." : `Import ${summary?.leads ?? 0} lead${summary?.leads === 1 ? "" : "s"}`}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <input
            ref={input}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            aria-label="CSV file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void readFile(file);
            }}
          />
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn("flex flex-wrap items-center gap-3 rounded-lg border-2 border-dashed px-4 py-4", dragging ? "border-brand-700 bg-brand-50" : "border-slate-300 bg-panel/60")}
          >
            <FileUp className="h-6 w-6 text-slate-400" />
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-semibold text-slate-900">{fileName ?? "Drop a CSV file here"}</p>
              <p className="text-xs text-slate-500">In Google Sheets: File, Download, Comma-separated values (.csv).</p>
            </div>
            <Button variant="ghost" size="sm" onClick={downloadTemplate}>
              <Download /> Template
            </Button>
            <Button variant="secondary" size="sm" disabled={checking || run.isPending} onClick={() => input.current?.click()}>
              {checking ? "Checking..." : fileName ? "Choose another file" : "Choose file"}
            </Button>
          </div>

          {fileError ? <p className="rounded-md bg-invisible-soft px-3 py-2 text-sm text-invisible">{fileError}</p> : null}

          {plan && summary ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Segmented
                  label="Filter rows"
                  size="sm"
                  value={filter}
                  onChange={setFilter}
                  options={[
                    { value: "all", label: `All ${plan.rows.length}` },
                    { value: "ready", label: `Ready ${summary.ready}` },
                    { value: "duplicate", label: `Duplicates ${summary.duplicate}` },
                    { value: "error", label: `Errors ${summary.error}` },
                  ]}
                />
                {plan.ignoredColumns.length ? <p className="text-xs text-slate-500">Not imported: {plan.ignoredColumns.join(", ")}</p> : null}
              </div>
              <div className="max-h-[50vh] overflow-auto rounded-md border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-panel text-left text-slate-700">
                    <tr>
                      <th className="px-2.5 py-2 font-semibold">Row</th>
                      <th className="px-2.5 py-2 font-semibold">Check</th>
                      {Array.from({ length: width }, (_, i) => (
                        <th key={i} className="px-2.5 py-2 font-semibold whitespace-nowrap">
                          {plan.headers[i]?.trim() || `Column ${i + 1}`}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((row) => (
                      <tr key={row.line} className={STATUS[row.status].row}>
                        <td className="px-2.5 py-1.5 tabular-nums text-slate-500">{row.line}</td>
                        <td className="px-2.5 py-1.5">
                          <Badge tone={STATUS[row.status].tone}>{STATUS[row.status].label}</Badge>
                          {row.message ? <p className="mt-0.5 max-w-64 text-[11px] text-slate-600">{row.message}</p> : null}
                        </td>
                        {Array.from({ length: width }, (_, i) => (
                          <td key={i} className="px-2.5 py-1.5 whitespace-nowrap text-slate-800">
                            {row.cells[i] ?? ""}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length === 0 ? <p className="px-3 py-4 text-center text-xs text-slate-500">No rows in this view.</p> : null}
              </div>
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
