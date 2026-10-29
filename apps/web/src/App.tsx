import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { Session } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, LogOut } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { LogoMark, Wordmark } from "@/components/Logo";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { LeadPage } from "@/pages/LeadPage";
import { LeadsPage } from "@/pages/LeadsPage";
import { LoginPage } from "@/pages/LoginPage";

function useSession(): Session | null | undefined {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);
  return session;
}

function UserMenu({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="flex items-center gap-2 rounded-md py-1 pr-2 pl-1 text-sm text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-white">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/15 text-xs font-semibold text-white uppercase ring-1 ring-white/25">{email[0]}</span>
        <span className="hidden max-w-48 truncate sm:inline">{email}</span>
        <ChevronDown className="h-3.5 w-3.5 text-white/50" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className="z-50 min-w-56 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
          <div className="px-3 py-2">
            <p className="text-xs text-slate-500">Signed in as</p>
            <p className="truncate text-sm font-medium text-slate-900">{email}</p>
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-slate-100" />
          <DropdownMenu.Item
            onSelect={onSignOut}
            className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 outline-none data-highlighted:bg-slate-100"
          >
            <LogOut className="h-4 w-4 text-slate-500" /> Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function App() {
  const session = useSession();
  const queryClient = useQueryClient();
  const { pathname } = useLocation();
  const onLeads = pathname === "/" || pathname.startsWith("/leads/");

  if (session === undefined) return null;
  if (!session) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }

  const signOut = async () => {
    await supabase.auth.signOut();
    queryClient.clear();
  };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 bg-brand-900 text-white">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-8">
          <div className="flex h-full items-center gap-8">
            <Link to="/" className="flex items-center gap-2.5">
              <LogoMark className="h-8 w-8" />
              <span className="flex flex-col">
                <Wordmark className="leading-none" />
                <span className="mt-0.5 text-[10px] font-semibold tracking-[0.08em] text-white/55 uppercase">LeadGenerators Digital</span>
              </span>
            </Link>
            <nav className="hidden h-full sm:flex">
              <Link
                to="/"
                className={cn(
                  "flex items-center border-b-2 px-1 pt-0.5 text-[13px] font-semibold transition-colors",
                  onLeads ? "border-white text-white" : "border-transparent text-white/60 hover:text-white",
                )}
              >
                Leads
              </Link>
            </nav>
          </div>
          <UserMenu email={session.user.email ?? ""} onSignOut={() => void signOut()} />
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-8 sm:py-10">
        <Routes>
          <Route path="/" element={<LeadsPage />} />
          <Route path="/leads/:id" element={<LeadPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-5 text-xs text-slate-500 sm:px-8">
          <span>
            <span className="font-display text-sm font-semibold text-slate-800">LeadGenerators Digital</span> - Lead Visibility Tool
          </span>
          <span className="tabular-nums text-[11px]">Rankings: Google in each lead's country, desktop. Visible = top 20.</span>
        </div>
      </footer>
    </div>
  );
}
