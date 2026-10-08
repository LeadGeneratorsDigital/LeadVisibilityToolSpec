import { AlertCircle } from "lucide-react";
import { useState, type FormEvent } from "react";
import { LogoMark, Wordmark } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase";

const HIGHLIGHTS = [
  { title: "Monthly Google rankings", text: "See where every lead appears for the phrases their buyers search." },
  { title: "Briefs that stay current", text: "Drop in rough notes and merge them into a clean brief." },
  { title: "Follow-ups in one click", text: "Copy a ready-made prompt and every contact email." },
];

/** Spec section 7: email, password and "Sign in" only - no sign-up link. */
export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (signInError) setError(signInError.message);
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-brand-900 p-14 text-slate-100 lg:flex">
        <svg aria-hidden viewBox="0 0 60 30" preserveAspectRatio="xMidYMid slice" className="pointer-events-none absolute inset-0 h-full w-full text-white opacity-[0.05]">
          <path d="M0 0L60 30M60 0L0 30" stroke="currentColor" strokeWidth="5" />
          <path d="M30 0V30M0 15H60" stroke="currentColor" strokeWidth="8" />
        </svg>
        <div className="relative flex items-center gap-2.5">
          <LogoMark />
          <Wordmark className="text-white" />
        </div>
        <div className="relative max-w-lg">
          <span aria-hidden className="mb-6 block h-1 w-12 bg-crimson" />
          <p className="eyebrow text-brand-100/70">Search visibility for your pipeline</p>
          <h2 className="mt-4 font-display text-[2.6rem] leading-[1.12] font-medium tracking-tight text-white">Know exactly how visible every lead is on Google.</h2>
          <ol className="mt-12 divide-y divide-white/10 border-y border-white/10">
            {HIGHLIGHTS.map(({ title, text }, i) => (
              <li key={title} className="flex gap-6 py-5">
                <span className="font-display text-lg text-brand-100/60 tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <p className="font-medium text-white">{title}</p>
                  <p className="mt-1 text-sm text-brand-100/70">{text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <p className="relative text-xs text-brand-100/50">Private tool. Accounts are created by the administrator.</p>
      </aside>

      <main className="flex items-center justify-center px-6 py-12">
        <form onSubmit={submit} className="w-full max-w-sm">
          <div className="mb-10 flex items-center gap-2.5 lg:hidden">
            <LogoMark />
            <Wordmark />
          </div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-slate-900">Sign in</h1>
          <p className="mt-2 text-sm text-slate-500">Welcome back. Enter your details to continue.</p>

          <div className="mt-8 space-y-4">
            <Field label="Email address" htmlFor="email">
              <Input id="email" type="email" autoComplete="email" autoFocus required className="h-10" placeholder="name@company.co.uk" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Password" htmlFor="password">
              <Input id="password" type="password" autoComplete="current-password" required className="h-10" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
          </div>

          {error ? (
            <p role="alert" className="mt-4 flex items-start gap-2 rounded-md border border-invisible/20 bg-invisible-soft px-3 py-2.5 text-sm text-invisible">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </p>
          ) : null}

          <Button type="submit" className="mt-6 h-10 w-full" disabled={busy}>
            {busy ? "Signing in..." : "Sign in"}
          </Button>
        </form>
      </main>
    </div>
  );
}
