/**
 * Demo only: writes `months` of ranking history before the current month using the same
 * generator as the mock DataForSEO client, so a live mock pull continues the trend instead of jumping.
 * Overwrites history months; never touches the current month.
 * Usage: pnpm --filter @lvt/api seed-history [months=6]
 */
import { createClient } from "@supabase/supabase-js";
import { currentMonthKey, mockOrganicRank, monthsEndingAt, NOT_RANKED_POSITION } from "@lvt/shared";
import { loadConfig } from "../src/config";

const months = Number(process.argv[2] ?? 6);
const config = loadConfig();
const db = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const history = monthsEndingAt(currentMonthKey(new Date()), months + 1).slice(0, -1);

const { data: phrases, error } = await db.from("phrases").select("id, phrase_text, leads(website_domain)").eq("is_heading", false);
if (error) throw new Error(error.message);

const rows = (phrases ?? []).flatMap((phrase) => {
  const domain = (phrase.leads as unknown as { website_domain: string | null } | null)?.website_domain;
  if (!domain) return [];
  return history.map((month, i) => ({
    phrase_id: phrase.id,
    month,
    // Roughly 1 in 14 historical cells blank, to show the "no data" state.
    position: (phrase.phrase_text.length * 7 + i * 3) % 14 === 0 ? null : (mockOrganicRank(phrase.phrase_text, domain, month) ?? NOT_RANKED_POSITION),
  }));
});

const { error: upsertError } = await db.from("rankings").upsert(rows, { onConflict: "phrase_id,month" });
if (upsertError) throw new Error(upsertError.message);
console.log(`Wrote ${rows.length} ranking cells for ${history[0]} .. ${history[history.length - 1]}`);
