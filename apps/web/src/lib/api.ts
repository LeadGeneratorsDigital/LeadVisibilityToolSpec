import { supabase } from "./supabase";

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

async function post<T>(path: string, body?: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your session has expired - please sign in again");

  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: body === undefined ? { Authorization: `Bearer ${token}` } : { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(payload.error ?? `Request failed (${res.status})`);
  return payload as T;
}

export const api = {
  pullLead: (leadId: string) => post<{ runId: string }>(`/api/leads/${leadId}/pull`),
  pullAll: () => post<{ started: Array<{ leadId: string; runId: string }>; skipped: Array<{ leadId: string; reason: string }> }>("/api/pull-all"),
  mergeBrief: (brief: string, notes: string) => post<{ brief: string; mode: "claude" | "mock" }>("/api/brief/merge", { brief, notes }),
};
