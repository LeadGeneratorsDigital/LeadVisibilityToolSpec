import type { QueryClient } from "@tanstack/react-query";
import { decodeCsv } from "./csv";
import { data } from "./data";
import { planImport, type ImportPlan } from "./lead-import";

/** Checks the file against the leads and contact emails as they are now, never a cached copy. */
export async function planImportFile(file: Blob): Promise<ImportPlan> {
  const [bytes, leads, contacts, locations] = await Promise.all([file.arrayBuffer(), data.leads(), data.contactEmails(), data.locations()]);
  return planImport(decodeCsv(bytes), { leads, contacts, locations });
}

/** Imports the plan's leads, then marks every lead and contact query stale so the next check sees them. */
export async function runImport(plan: ImportPlan, queryClient: QueryClient): Promise<number> {
  const count = await data.importLeads(plan.leads);
  await Promise.all([queryClient.invalidateQueries({ queryKey: ["leads"] }), queryClient.invalidateQueries({ queryKey: ["contacts"] })]);
  return count;
}
