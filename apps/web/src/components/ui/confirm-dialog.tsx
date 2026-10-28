import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";

export interface ConfirmOptions {
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  /** A second, lesser choice shown between Cancel and the main button. */
  alternative?: { label: string; onSelect: () => void };
}

/**
 * In-app replacement for window.confirm. Render `dialog` once inside the component (inside an open
 * Radix dialog when called from one, so focus stays trapped there), then call `confirm(options)`.
 */
export function useConfirm(): { confirm: (options: ConfirmOptions) => void; dialog: ReactNode } {
  const [pending, setPending] = useState<ConfirmOptions | null>(null);
  const dialog = (
    <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
      {pending ? (
        <DialogContent
          title={pending.title}
          className="max-w-md"
          footer={
            <>
              <Button variant="secondary" onClick={() => setPending(null)}>
                Cancel
              </Button>
              {pending.alternative ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setPending(null);
                    pending.alternative!.onSelect();
                  }}
                >
                  {pending.alternative.label}
                </Button>
              ) : null}
              <Button
                variant={pending.destructive ? "destructive" : "primary"}
                onClick={() => {
                  setPending(null);
                  pending.onConfirm();
                }}
              >
                {pending.confirmLabel}
              </Button>
            </>
          }
        >
          <p className="text-sm text-slate-600">{pending.description}</p>
        </DialogContent>
      ) : null}
    </Dialog>
  );
  return { confirm: setPending, dialog };
}
