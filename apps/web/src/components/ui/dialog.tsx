import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;

export function DialogContent({
  title,
  description,
  children,
  footer,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-brand-900/45 backdrop-blur-[2px]" />
      <DialogPrimitive.Content
        className={cn(
          "fixed top-1/2 left-1/2 z-50 flex max-h-[88vh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border-t-4 border-crimson bg-white shadow-[0_4px_12px_rgba(17,29,46,0.12)] focus:outline-none",
          className,
        )}
      >
        <div className="px-6 pt-5 pb-4">
          <DialogPrimitive.Title className="pr-8 font-display text-2xl font-semibold text-slate-900">{title}</DialogPrimitive.Title>
          {description ? <DialogPrimitive.Description className="mt-1 text-sm text-slate-500">{description}</DialogPrimitive.Description> : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-5">{children}</div>
        {footer ? <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-panel px-6 py-3">{footer}</div> : null}
        <DialogPrimitive.Close className="absolute top-5 right-5 rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900" aria-label="Close">
          <X className="h-5 w-5" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
