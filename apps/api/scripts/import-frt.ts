/**
 * One-time move of the client's old FRT workbook into the database: leads, contacts, headings,
 * key phrases and every past monthly ranking. Dry run by default; --apply writes, and only when
 * --target names the project SUPABASE_URL points at, so a stale .env cannot write to the wrong one.
 * Usage: pnpm --filter @lvt/api import-frt <workbook.xlsx> [--apply --target <project-ref>] [--report <file.json>]
 *
 * Leads whose business name already exists are skipped, so a re-run after a failure only adds what
 * is missing. Each lead is written whole or removed again (contacts, phrases and rankings cascade).
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import { keywordKey } from "@lvt/shared";
import { loadConfig } from "../src/config";
import { parseWorkbook } from "./frt/parse-workbook";
import { applyPlan, exitCode, MAX_CONSECUTIVE_FAILURES, type FrtStore, type LeadResult, type Outcome } from "./frt/write-plan";

const USAGE = "Usage: pnpm --filter @lvt/api import-frt <workbook.xlsx> [--apply --target <project-ref>] [--report <file.json>]";
const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const valueArgs = new Set(["--report", "--target"].map((name) => option(name)));
const file = args.find((a) => !a.startsWith("--") && !valueArgs.has(a));
const apply = args.includes("--apply");
const reportPath = resolve(option("--report") ?? "frt-import-report.json");
if (!file) {
  console.error(USAGE);
  process.exit(1);
}

const config = loadConfig();
// "<ref>.supabase.co" is named by its ref; any other host (a local stack) by the whole host name.
const host = new URL(config.SUPABASE_URL).hostname;
const projectName = host.endsWith(".supabase.co") ? host.split(".")[0]! : host;
if (apply && option("--target") !== projectName) {
  console.error(`--apply needs --target ${projectName} to confirm the project SUPABASE_URL points at (${config.SUPABASE_URL}).\n${USAGE}`);
  process.exit(1);
}
const db = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(file);
const plan = parseWorkbook(workbook);

// Paged: PostgREST cuts a response at max_rows (1000 on Supabase).
const existing = new Set<string>();
for (let from = 0; ; from += 1000) {
  const { data: page, error } = await db.from("leads").select("business_name").order("id").range(from, from + 999);
  if (error) {
    console.error(`Could not read existing leads: ${error.message}`);
    process.exit(1);
  }
  if (page.length === 0) break;
  for (const row of page) existing.add(keywordKey(row.business_name as string));
}

const results: LeadResult[] = [];
const report = () => ({
  file: resolve(file),
  target: config.SUPABASE_URL,
  mode: apply ? "apply" : "dry run",
  totals: {
    leads: plan.leads.length,
    contacts: plan.leads.reduce((n, l) => n + l.contacts.length, 0),
    headings: plan.leads.reduce((n, l) => n + l.groups.filter((g) => g.name !== null).length, 0),
    phrases: plan.leads.reduce((n, l) => n + l.groups.reduce((m, g) => m + g.phrases.length, 0), 0),
    rankings: plan.leads.reduce((n, l) => n + l.groups.reduce((m, g) => m + g.phrases.reduce((k, p) => k + p.rankings.length, 0), 0), 0),
  },
  results,
  skipped_tabs: plan.skipped,
  leads: plan.leads.map((l) => ({
    sheet: l.sheet,
    business_name: l.business_name,
    website_domain: l.website_domain,
    location_code: l.location_code,
    contacts: l.contacts.length,
    headings: l.groups.filter((g) => g.name !== null).map((g) => g.name),
    phrases: l.groups.reduce((m, g) => m + g.phrases.length, 0),
    rankings: l.groups.reduce((m, g) => m + g.phrases.reduce((k, p) => k + p.rankings.length, 0), 0),
    first_month: l.first_month,
    latest_month: l.latest_month,
    warnings: l.warnings,
  })),
});
// Written before the first insert and after every lead, so a run killed part-way still says what it did.
const saveReport = () => writeFileSync(reportPath, `${JSON.stringify(report(), null, 2)}\n`);

function must<T>(result: { data: T | null; error: { message: string } | null }, step: string): T {
  if (result.error) throw new Error(`${step}: ${result.error.message}`);
  if (result.data === null) throw new Error(`${step}: no data returned`);
  return result.data;
}

const store: FrtStore = {
  insertLead: async (row) => must<{ id: string }>(await db.from("leads").insert(row).select("id").single(), "Insert lead").id,
  insertContacts: async (rows) => void must(await db.from("contacts").insert(rows).select("id"), "Insert contacts"),
  insertHeading: async (row) => must<{ id: string }>(await db.from("buyer_groups").insert(row).select("id").single(), "Insert heading").id,
  insertPhrases: async (rows) => must<Array<{ id: string; sort_order: number }>>(await db.from("phrases").insert(rows).select("id, sort_order"), "Insert phrases"),
  insertRankings: async (rows) => void must(await db.from("rankings").insert(rows).select("id"), "Insert rankings"),
  deleteLead: async (id) => {
    const { error } = await db.from("leads").delete().eq("id", id);
    if (error) throw new Error(error.message);
  },
};

for (const lead of plan.leads) {
  const already = existing.has(keywordKey(lead.business_name));
  results.push({ sheet: lead.sheet, business_name: lead.business_name, outcome: already ? "already exists" : apply ? "not attempted" : "would import" });
}
saveReport();

const stoppedEarly = apply
  ? await applyPlan(store, plan.leads, results, (result) => {
      saveReport();
      console.log(`${result.outcome.padEnd(14)} ${result.business_name}${result.error ? ` - ${result.error}` : ""}`);
    })
  : false;

const count = (outcome: Outcome) => results.filter((r) => r.outcome === outcome).length;
const { totals } = report();
console.log(`\n${apply ? "Applied" : "Dry run"} against ${config.SUPABASE_URL}`);
console.log(`Workbook: ${totals.leads} leads, ${totals.contacts} contacts, ${totals.headings} headings, ${totals.phrases} phrases, ${totals.rankings} rankings`);
console.log(`Skipped tabs: ${plan.skipped.length}; leads with warnings: ${plan.leads.filter((l) => l.warnings.length > 0).length}`);
console.log(
  apply
    ? `Imported ${count("imported")}, already there ${count("already exists")}, failed ${count("failed")}, not attempted ${count("not attempted")}`
    : `Would import ${count("would import")}, already there ${count("already exists")}`,
);
if (stoppedEarly) console.log(`Stopped after ${MAX_CONSECUTIVE_FAILURES} failed leads in a row - fix the cause and run again.`);
console.log(`Full report: ${reportPath}`);
process.exit(exitCode(results));
