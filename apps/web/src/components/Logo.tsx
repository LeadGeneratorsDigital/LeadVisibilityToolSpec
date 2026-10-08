import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex h-7 w-7 items-center justify-center rounded-md bg-crimson text-white", className)}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
        <path d="M4 19h16" />
        <path d="M6 15l4-5 3 3 5-7" />
      </svg>
    </span>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return <span className={cn("font-display text-[19px] font-semibold tracking-tight", className)}>Lead Visibility</span>;
}
