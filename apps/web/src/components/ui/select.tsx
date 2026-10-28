import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { field } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Radix Select items cannot use "" as a value, so "no value" travels as this sentinel. */
export const NONE = "__none__";

/** Radix shows the placeholder only for "", so null renders as the empty option when there is one. */
export function toRadixValue(value: string | null, hasEmptyOption: boolean): string {
  return value ?? (hasEmptyOption ? NONE : "");
}

export function fromRadixValue(next: string): string | null {
  return next === NONE ? null : next;
}

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
}

/**
 * Styled replacement for <select>: the native option list is drawn by the OS and cannot be themed.
 * `emptyLabel` adds a first option that maps to null; without it null shows `placeholder`.
 */
export function Select({
  id,
  value,
  onChange,
  options,
  placeholder,
  emptyLabel,
  className,
  ariaLabel,
}: {
  id?: string;
  /** Accessible name when no <label> points at `id`. */
  ariaLabel?: string;
  value: string | null;
  onChange: (value: string | null) => void;
  options: SelectOption[];
  placeholder?: string;
  emptyLabel?: string;
  className?: string;
}) {
  return (
    <SelectPrimitive.Root value={toRadixValue(value, Boolean(emptyLabel))} onValueChange={(next) => onChange(fromRadixValue(next))}>
      <SelectPrimitive.Trigger
        id={id}
        aria-label={ariaLabel}
        className={cn(field, "flex h-[38px] items-center justify-between gap-2 text-left data-[placeholder]:text-slate-400 data-[state=open]:border-brand-700 data-[state=open]:bg-white", className)}
      >
        <span className="truncate">
          <SelectPrimitive.Value placeholder={placeholder} />
        </span>
        <SelectPrimitive.Icon asChild>
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className="z-[60] max-h-[min(var(--radix-select-content-available-height),18rem)] w-[var(--radix-select-trigger-width)] min-w-40 overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg"
        >
          <SelectPrimitive.Viewport className="p-1">
            {emptyLabel ? <Item value={NONE} label={emptyLabel} muted /> : null}
            {options.map((option) => (
              <Item key={option.value} value={option.value} label={option.label} hint={option.hint} />
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

function Item({ value, label, hint, muted = false }: { value: string; label: string; hint?: string; muted?: boolean }) {
  return (
    <SelectPrimitive.Item
      value={value}
      className={cn(
        "relative flex cursor-default items-center gap-2 rounded-sm py-2 pr-8 pl-3 text-sm outline-none select-none",
        "data-[highlighted]:bg-panel data-[state=checked]:font-semibold data-[state=checked]:text-brand-700",
        muted ? "text-slate-500" : "text-slate-900",
      )}
    >
      <SelectPrimitive.ItemText>{label}</SelectPrimitive.ItemText>
      {hint ? <span className="font-mono text-[11px] text-slate-400">{hint}</span> : null}
      <SelectPrimitive.ItemIndicator className="absolute right-2.5 inline-flex">
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}
