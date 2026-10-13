import { Loader2 } from "lucide-react";
import { Children, forwardRef, isValidElement, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const variants = {
  primary: "bg-brand-700 text-white hover:bg-brand-800",
  secondary: "border border-slate-300 bg-white text-brand-700 hover:border-brand-700/60 hover:bg-brand-700/5",
  ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
  destructive: "bg-crimson text-white hover:bg-crimson/90",
};
const sizes = {
  sm: "h-8 gap-1.5 px-3 text-[13px]",
  md: "h-9 gap-2 px-4 text-[13px]",
  icon: "h-8 w-8",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  /** Disables the button and spins its leading icon, or shows a spinner when it has none. */
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", type = "button", loading = false, disabled, children, ...props }, ref) => {
    const leadingIcon = isValidElement(Children.toArray(children)[0]);
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-md font-semibold tracking-[0.01em] whitespace-nowrap transition-colors",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 disabled:pointer-events-none disabled:opacity-45",
          "[&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0",
          loading && "disabled:opacity-70",
          loading && leadingIcon && "[&>svg:first-child]:animate-spin",
          variants[variant],
          sizes[size],
          className,
        )}
        {...props}
      >
        {loading && !leadingIcon ? <Loader2 className="animate-spin" aria-hidden /> : null}
        {children}
      </button>
    );
  },
);
Button.displayName = "Button";
