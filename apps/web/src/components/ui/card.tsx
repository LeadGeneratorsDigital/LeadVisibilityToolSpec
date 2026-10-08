import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Card({
  title,
  icon,
  badge,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  icon?: ReactNode;
  badge?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("rounded-lg border border-slate-200 bg-white", className)}>
      {title || actions ? (
        <header className="flex flex-wrap items-start justify-between gap-3 px-6 pt-5 pb-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {icon ? <span className="text-brand-700 [&_svg]:h-[18px] [&_svg]:w-[18px]">{icon}</span> : null}
              <h2 className="font-display text-[19px] leading-snug font-semibold text-slate-900">{title}</h2>
              {badge}
            </div>
            {description ? <p className="mt-0.5 text-xs text-slate-500">{description}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={cn("px-6 pb-6", !title && !actions && "pt-6", bodyClassName)}>{children}</div>
    </section>
  );
}

const tones = {
  neutral: "bg-slate-100 text-slate-800",
  green: "bg-visible-soft text-visible",
  amber: "bg-partly-soft text-partly",
  red: "bg-invisible-soft text-invisible",
  blue: "bg-brand-50 text-brand-700",
  violet: "bg-indigo-50 text-indigo-800",
};

export type BadgeTone = keyof typeof tones;

export function Badge({ children, tone = "neutral", className, title }: { children: ReactNode; tone?: BadgeTone; className?: string; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap [&_svg]:h-3 [&_svg]:w-3", tones[tone], className)}>
      {children}
    </span>
  );
}

export function Avatar({ text, className }: { text: string; className?: string }) {
  return (
    <span aria-hidden className={cn("inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand-700 font-display text-[15px] font-semibold text-white", className)}>
      {text}
    </span>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      {icon ? <div className="mb-3 rounded-md bg-panel p-3 text-slate-500 [&_svg]:h-5 [&_svg]:w-5">{icon}</div> : null}
      <p className="font-display text-lg font-semibold text-slate-900">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
