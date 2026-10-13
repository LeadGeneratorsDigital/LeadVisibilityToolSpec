import { keywordKey, normalizeDomain } from "@lvt/shared";
import { parseCsv } from "./csv";
import { isEmail } from "./leads-table";
import { MAX_CONTACTS, type LeadStatus, type LocationCode } from "./types";

/**
 * Provisional layout until the FRT Sheet sample arrives: one row per contact, lead columns repeated
 * on each of the lead's rows (rows with the same business name are one lead). A lead with no
 * contacts is a single row with the contact columns blank.
 */
export const IMPORT_COLUMNS = [
  { field: "business_name", label: "Business name", aliases: ["business", "company", "company name", "lead", "lead name"] },
  { field: "website_domain", label: "Website", aliases: ["website domain", "domain", "url"] },
  { field: "industry", label: "Industry", aliases: ["category", "industry / category"] },
  { field: "location", label: "Location", aliases: [] },
  { field: "status", label: "Status", aliases: [] },
  { field: "next_email_due", label: "Next email due", aliases: ["next email"] },
  { field: "contact_name", label: "Contact name", aliases: ["name", "contact"] },
  { field: "job_title", label: "Job title", aliases: ["title", "role"] },
  { field: "email", label: "Email", aliases: ["email address", "contact email"] },
] as const;

type Field = (typeof IMPORT_COLUMNS)[number]["field"];
type LeadField = "website_domain" | "industry" | "location" | "status" | "next_email_due";
const LEAD_FIELDS: LeadField[] = ["website_domain", "industry", "location", "status", "next_email_due"];
const STATUSES: LeadStatus[] = ["active", "paused", "converted"];

export const IMPORT_TEMPLATE = `${IMPORT_COLUMNS.map((c) => c.label).join(",")}\r\n`;

export type ImportRowStatus = "ready" | "duplicate" | "error";

export interface ImportRow {
  /** Row number as the spreadsheet shows it; the heading row is 1. */
  line: number;
  cells: string[];
  status: ImportRowStatus;
  message: string | null;
}

export interface ImportContact {
  name: string;
  job_title: string | null;
  email: string;
}

export interface ImportLead {
  business_name: string;
  website_domain: string | null;
  industry: string | null;
  location_code: string | null;
  status: LeadStatus;
  next_email_due: string | null;
  contacts: ImportContact[];
}

export interface ImportPlan {
  headers: string[];
  ignoredColumns: string[];
  rows: ImportRow[];
  leads: ImportLead[];
}

export interface ExistingContact {
  email: string;
  lead_name: string;
}

export interface ImportContext {
  leads: Array<{ business_name: string }>;
  contacts: ExistingContact[];
  locations: LocationCode[];
}

export class ImportFileError extends Error {}

const headerKey = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");
const LABEL = new Map<Field, string>(IMPORT_COLUMNS.map((c) => [c.field, c.label]));
const FIELD_BY_HEADER = new Map<string, Field>(IMPORT_COLUMNS.flatMap((c) => [c.label, ...c.aliases].map((a) => [headerKey(a), c.field] as [string, Field])));

function mapColumns(headers: string[]): { columns: Map<Field, number>; ignored: string[] } {
  const columns = new Map<Field, number>();
  const ignored: string[] = [];
  headers.forEach((heading, index) => {
    const field = FIELD_BY_HEADER.get(headerKey(heading));
    if (!field) {
      if (heading.trim()) ignored.push(heading.trim());
      return;
    }
    const taken = columns.get(field);
    if (taken !== undefined) throw new ImportFileError(`Columns "${headers[taken]!.trim()}" and "${heading.trim()}" both look like ${LABEL.get(field)}`);
    columns.set(field, index);
  });
  return { columns, ignored };
}

/** YYYY-MM-DD, or UK DD/MM/YYYY as Sheets shows dates. Null when it is not a real calendar date. */
export function parseImportDate(text: string): string | null {
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  const uk = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  const parts = iso ? [iso[1], iso[2], iso[3]] : uk ? [uk[3], uk[2], uk[1]] : null;
  if (!parts) return null;
  const [year, month, day] = parts.map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  // Any day or month out of range rolls Date.UTC into another month, so the month alone catches it.
  if (date.getUTCMonth() !== month - 1) return null;
  return date.toISOString().slice(0, 10);
}

export function importSummary(plan: ImportPlan): Record<ImportRowStatus, number> & { leads: number; contacts: number } {
  const counts = { ready: 0, duplicate: 0, error: 0 };
  for (const row of plan.rows) counts[row.status]++;
  return { ...counts, leads: plan.leads.length, contacts: plan.leads.reduce((sum, l) => sum + l.contacts.length, 0) };
}

interface ParsedRow {
  line: number;
  cells: string[];
  name: string;
  lead: Partial<Record<LeadField, string>>;
  leadErrors: string[];
  contact: ImportContact | null;
  contactError: string | null;
}

function parseRow(line: number, cells: string[], columns: Map<Field, number>, locations: LocationCode[]): ParsedRow {
  const get = (field: Field) => {
    const index = columns.get(field);
    return index === undefined ? "" : (cells[index] ?? "").trim();
  };
  const row: ParsedRow = { line, cells, name: get("business_name"), lead: {}, leadErrors: [], contact: null, contactError: null };

  const website = get("website_domain");
  if (website) {
    const domain = normalizeDomain(website);
    if (domain) row.lead.website_domain = domain;
    else row.leadErrors.push(`"${website}" is not a website`);
  }
  const industry = get("industry");
  if (industry) row.lead.industry = industry;
  const location = get("location").toLowerCase();
  if (location) {
    const match = locations.find((l) => l.code.toLowerCase() === location || l.label.toLowerCase() === location);
    if (match) row.lead.location = match.code;
    else row.leadErrors.push(`Unknown location "${get("location")}"`);
  }
  const status = get("status").toLowerCase();
  if (status) {
    if ((STATUSES as string[]).includes(status)) row.lead.status = status;
    else row.leadErrors.push("Status must be active, paused or converted");
  }
  const due = get("next_email_due");
  if (due) {
    const date = parseImportDate(due);
    if (date) row.lead.next_email_due = date;
    else row.leadErrors.push(`Next email due "${due}" is not a date - use YYYY-MM-DD or DD/MM/YYYY`);
  }

  const contactName = get("contact_name");
  const email = get("email");
  const jobTitle = get("job_title");
  if (contactName || email || jobTitle) {
    if (!contactName || !email) row.contactError = "A contact needs both a name and an email";
    else if (!isEmail(email)) row.contactError = `"${email}" is not a valid email`;
    else row.contact = { name: contactName, job_title: jobTitle || null, email };
  }
  return row;
}

type Outcome = { status: ImportRowStatus; message: string | null };
const error = (...messages: Array<string | null>): Outcome => ({ status: "error", message: messages.filter(Boolean).join("; ") });

/**
 * Checks a CSV export against the saved leads and contacts. Rows are skipped, never half-imported:
 * a lead that already exists, an email seen on an earlier row or already saved on any lead, and any
 * row with an error. A lead is imported when at least one of its rows is ready; a lead-level error
 * on any row makes every row of that lead an error.
 */
export function planImport(text: string, context: ImportContext): ImportPlan {
  const table = parseCsv(text)
    .map((cells, index) => ({ line: index + 1, cells }))
    .filter((r) => r.cells.some((c) => c.trim() !== ""));
  const [heading, ...body] = table;
  if (!heading) throw new ImportFileError("The file is empty");
  const { columns, ignored } = mapColumns(heading.cells);
  if (!columns.has("business_name")) throw new ImportFileError('No "Business name" column - the first row must hold the column headings');
  if (body.length === 0) throw new ImportFileError("The file has column headings but no rows");

  const parsed = body.map((r) => parseRow(r.line, r.cells, columns, context.locations));
  const existingLeads = new Set(context.leads.map((l) => keywordKey(l.business_name)));
  const savedEmails = new Map(context.contacts.map((c) => [c.email.trim().toLowerCase(), c.lead_name]));
  const firstLineByEmail = new Map<string, number>();
  for (const row of parsed) {
    const key = row.contact?.email.toLowerCase();
    if (key && !firstLineByEmail.has(key)) firstLineByEmail.set(key, row.line);
  }

  const outcomes = new Map<ParsedRow, Outcome>();
  const groups = new Map<string, ParsedRow[]>();
  for (const row of parsed) {
    if (!row.name) outcomes.set(row, error("Business name is missing"));
    else groups.set(keywordKey(row.name), [...(groups.get(keywordKey(row.name)) ?? []), row]);
  }

  const leads: ImportLead[] = [];
  for (const [key, rows] of groups) {
    if (existingLeads.has(key)) {
      for (const row of rows) outcomes.set(row, { status: "duplicate", message: "Lead already exists - add new contacts on its page" });
      continue;
    }

    const merged: Partial<Record<LeadField, { value: string; line: number }>> = {};
    for (const row of rows) {
      for (const field of LEAD_FIELDS) {
        const value = row.lead[field];
        if (value === undefined) continue;
        const first = merged[field];
        if (!first) merged[field] = { value, line: row.line };
        else if (first.value !== value) row.leadErrors.push(`${LABEL.get(field)} differs from row ${first.line}`);
      }
    }
    const leadErrorLine = rows.find((r) => r.leadErrors.length > 0)?.line;

    const contacts: ImportContact[] = [];
    for (const row of rows) {
      outcomes.set(row, classify(row));
    }
    if (rows.some((r) => outcomes.get(r)!.status === "ready")) {
      leads.push({
        business_name: rows[0]!.name,
        website_domain: merged.website_domain?.value ?? null,
        industry: merged.industry?.value ?? null,
        location_code: merged.location?.value ?? null,
        status: (merged.status?.value as LeadStatus | undefined) ?? "active",
        next_email_due: merged.next_email_due?.value ?? null,
        contacts,
      });
    }

    function classify(row: ParsedRow): Outcome {
      if (row.leadErrors.length > 0) return error(...row.leadErrors, row.contactError);
      if (leadErrorLine !== undefined) return error(`Lead has an error on row ${leadErrorLine}`, row.contactError);
      if (row.contactError) return error(row.contactError);
      if (!row.contact) return { status: "ready", message: null };
      const email = row.contact.email.toLowerCase();
      const firstLine = firstLineByEmail.get(email)!;
      if (firstLine !== row.line) return { status: "duplicate", message: `Same email as row ${firstLine} - contact skipped` };
      const savedFor = savedEmails.get(email);
      if (savedFor !== undefined) return { status: "duplicate", message: `Email already saved for ${savedFor} - contact skipped` };
      if (contacts.length >= MAX_CONTACTS) return error(`More than ${MAX_CONTACTS} contacts for this lead`);
      contacts.push(row.contact);
      return { status: "ready", message: null };
    }
  }

  return {
    headers: heading.cells,
    ignoredColumns: ignored,
    rows: parsed.map((row) => ({ line: row.line, cells: row.cells, ...outcomes.get(row)! })),
    leads,
  };
}
