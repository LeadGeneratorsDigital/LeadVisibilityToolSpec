import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Single-choice pill group (radio semantics). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  disabled,
  size = "md",
}: {
  value: T;
  options: Array<{ value: T; label: ReactNode }>;
  onChange: (value: T) => void;
  label: string;
  disabled?: boolean;
  size?: "sm" | "md";
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex max-w-full overflow-x-auto rounded-lg bg-panel-strong p-1">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => !active && onChange(option.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md font-semibold whitespace-nowrap transition-all disabled:opacity-50",
              size === "sm" ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-xs",
              active ? "bg-white text-brand-700 shadow-sm" : "text-slate-500 hover:text-slate-900",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
