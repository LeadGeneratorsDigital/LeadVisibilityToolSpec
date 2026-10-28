/**
 * Reads the client's old FRT workbook (one Google Sheets tab per prospect, exported as .xlsx) into
 * import plans. Layout, from the workbook's own "About" tab:
 * B3 "BUSINESS & SETTINGS", B4 business name, B5 website, D4 search engine ("Google UK" / "Google SA" /
 * "Google USA"), contacts in rows 9-11 (name in B, email in D), month headers ("Apr-25") in row 15
 * from column C, then from row 16 column B: bold = heading, not bold = phrase, five blank rows = end.
 */
import type { CellValue, Workbook, Worksheet } from "exceljs";
import { NOT_RANKED_POSITION, normalizeDomain, type MonthKey } from "@lvt/shared";

export type FrtLocation = "UK" | "ZA" | "US";

export interface FrtPhrase {
  text: string;
  rankings: Array<{ month: MonthKey; position: number }>;
}

export interface FrtGroup {
  /** Null for phrases above the first heading. */
  name: string | null;
  phrases: FrtPhrase[];
}

export interface FrtLead {
  sheet: string;
  business_name: string;
  website_domain: string | null;
  location_code: FrtLocation;
  contacts: Array<{ name: string; email: string }>;
  groups: FrtGroup[];
  /** Latest month with a ranking, or null when the tab has none. */
  latest_month: MonthKey | null;
  warnings: string[];
}

export interface FrtPlan {
  leads: FrtLead[];
  skipped: Array<{ sheet: string; reason: string }>;
}

const LAYOUT_MARKER = "BUSINESS & SETTINGS";
const ENGINE_LOCATION: Record<string, FrtLocation> = { "google uk": "UK", "google sa": "ZA", "google usa": "US" };
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const NOT_RANKED_TEXT = new Set(["not ranked", "not in the top 100"]);
const PLACEHOLDER = /^(enter .* here|optional)$/i;
const FIRST_DATA_ROW = 16;
const MONTH_ROW = 15;
const BLANK_ROWS_AT_END = 5;
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const EMAIL = /^\S+@\S+\.\S+$/;

/** Display text of a cell value: hyperlinks, rich text and formula results included; errors are blank. */
export function cellText(value: CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  if ("richText" in value) return value.richText.map((r) => r.text).join("");
  if ("text" in value) return cellText(value.text as CellValue);
  if ("result" in value) return cellText((value.result ?? null) as CellValue);
  return "";
}

const clean = (text: string) => text.replace(/\s+/g, " ").trim();

/** "Apr-25" or a real date in the header row, as the first of that month. */
export function parseMonthHeader(value: CellValue): MonthKey | null {
  if (value instanceof Date) return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const match = /^([A-Za-z]{3})-(\d{2})$/.exec(clean(cellText(value)));
  const monthIndex = match ? MONTHS.indexOf(match[1]!.toLowerCase()) : -1;
  return match && monthIndex >= 0 ? `20${match[2]}-${String(monthIndex + 1).padStart(2, "0")}-01` : null;
}

/**
 * One ranking cell as a stored position: 1-100 as written, anything past 100 or "Not Ranked" /
 * "Not in the Top 100" as NOT_RANKED_POSITION, blank as null. Anything else is an error message.
 */
export function parseRankingCell(value: CellValue): { position: number | null } | { error: string } {
  const text = clean(cellText(value));
  if (text === "") return { position: null };
  if (NOT_RANKED_TEXT.has(text.toLowerCase())) return { position: NOT_RANKED_POSITION };
  if (/^\d+$/.test(text)) {
    const n = Number(text);
    if (n >= 1) return { position: Math.min(n, NOT_RANKED_POSITION) };
  }
  return { error: `"${text}" is not a ranking` };
}

function isUpperCase(text: string): boolean {
  const letters = text.replace(/[^A-Za-z]/g, "");
  return letters.length > 0 && letters === letters.toUpperCase();
}

interface Row {
  row: number;
  text: string;
  bold: boolean;
}

function dataRows(ws: Worksheet): Row[] {
  const rows: Row[] = [];
  let blank = 0;
  for (let r = FIRST_DATA_ROW; r <= ws.rowCount; r++) {
    const cell = ws.getCell(r, 2);
    const text = clean(cellText(cell.value));
    if (!text) {
      if (++blank >= BLANK_ROWS_AT_END) break;
      continue;
    }
    blank = 0;
    rows.push({ row: r, text, bold: cell.font?.bold === true });
  }
  return rows;
}

/**
 * Headings become one level of groups. The workbook sometimes stacks two: an ALL-CAPS section
 * heading directly followed by a heading under it. Those are joined as "SECTION — Heading", because
 * the same lower heading can sit under two sections (search phrases and questions).
 */
function groupRows(ws: Worksheet, rows: Row[], months: Map<number, MonthKey>, warnings: string[]): FrtGroup[] {
  const groups: FrtGroup[] = [{ name: null, phrases: [] }];
  let section: { text: string; used: boolean } | null = null;
  const endSection = () => {
    if (section && !section.used) warnings.push(`Heading "${section.text}" has no phrases - left out`);
    section = null;
  };
  rows.forEach((row, i) => {
    if (row.bold) {
      const upper = isUpperCase(row.text);
      if (upper) endSection();
      if (upper && rows[i + 1]?.bold) {
        section = { text: row.text, used: false };
      } else if (section) {
        section.used = true;
        groups.push({ name: `${section.text} — ${row.text}`, phrases: [] });
      } else {
        groups.push({ name: row.text, phrases: [] });
      }
      return;
    }
    const phrase: FrtPhrase = { text: row.text, rankings: [] };
    for (let c = 3; c <= ws.columnCount; c++) {
      const value = ws.getCell(row.row, c).value;
      const month = months.get(c);
      const parsed = parseRankingCell(value);
      if ("error" in parsed) {
        warnings.push(`Row ${row.row}, column ${ws.getColumn(c).letter}: ${parsed.error} - left blank`);
      } else if (parsed.position !== null) {
        if (month) phrase.rankings.push({ month, position: parsed.position });
        else warnings.push(`Row ${row.row}, column ${ws.getColumn(c).letter}: ranking under no month heading - left out`);
      }
    }
    groups[groups.length - 1]!.phrases.push(phrase);
  });
  endSection();
  for (const g of groups) if (g.name !== null && g.phrases.length === 0) warnings.push(`Heading "${g.name}" has no phrases - left out`);
  return groups.filter((g) => g.phrases.length > 0);
}

function parseSheet(ws: Worksheet): FrtLead | { reason: string } {
  if (clean(ws.getCell("B3").text).toUpperCase() !== LAYOUT_MARKER) return { reason: `not in the "${LAYOUT_MARKER}" layout` };
  const business = clean(cellText(ws.getCell("B4").value));
  if (!business || PLACEHOLDER.test(business)) return { reason: "no business name (template tab)" };
  const engine = clean(cellText(ws.getCell("D4").value));
  const location = ENGINE_LOCATION[engine.toLowerCase()];
  if (!location) return { reason: `unknown search engine "${engine}" in D4` };

  const warnings: string[] = [];
  const site = clean(cellText(ws.getCell("B5").value));
  let website: string | null = null;
  if (site && !PLACEHOLDER.test(site)) {
    const domain = normalizeDomain(site);
    if (DOMAIN.test(domain)) website = domain;
    else warnings.push(`Website "${site}" is not a web address - left empty, so rankings cannot be updated until it is set`);
  } else {
    warnings.push("No website - rankings cannot be updated until it is set");
  }

  const contacts: FrtLead["contacts"] = [];
  for (let r = 9; r <= 11; r++) {
    const rawName = clean(cellText(ws.getCell(r, 2).value));
    const name = PLACEHOLDER.test(rawName) ? "" : rawName;
    const email = clean(cellText(ws.getCell(r, 4).value)).replace(/^mailto:/i, "");
    if (!name && !email) continue;
    if (!EMAIL.test(email)) warnings.push(`Contact on row ${r} (${name || "no name"}) has no valid email - left out`);
    else contacts.push({ name: name || email, email });
  }

  // A month stored twice would break the one-ranking-per-phrase-per-month rule and fail the lead.
  const months = new Map<number, MonthKey>();
  const monthColumn = new Map<MonthKey, string>();
  for (let c = 3; c <= ws.columnCount; c++) {
    const month = parseMonthHeader(ws.getCell(MONTH_ROW, c).value);
    if (!month) continue;
    const letter = ws.getColumn(c).letter;
    const first = monthColumn.get(month);
    if (first) {
      warnings.push(`Column ${letter} repeats the month in column ${first} - left out`);
      continue;
    }
    monthColumn.set(month, letter);
    months.set(c, month);
  }
  const groups = groupRows(ws, dataRows(ws), months, warnings);

  const seen = new Map<string, number>();
  for (const phrase of groups.flatMap((g) => g.phrases)) {
    const key = phrase.text.toLowerCase();
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const [text, count] of seen) if (count > 1) warnings.push(`Phrase "${text}" is listed ${count} times`);
  if (seen.size === 0) warnings.push("No key phrases");

  const latest = groups.flatMap((g) => g.phrases.flatMap((p) => p.rankings.map((r) => r.month))).sort().at(-1) ?? null;
  return { sheet: ws.name, business_name: business, website_domain: website, location_code: location, contacts, groups, latest_month: latest, warnings };
}

export function parseWorkbook(workbook: Workbook): FrtPlan {
  const plan: FrtPlan = { leads: [], skipped: [] };
  const names = new Map<string, string>();
  for (const ws of workbook.worksheets) {
    if (ws.state !== "visible") {
      plan.skipped.push({ sheet: ws.name, reason: "hidden tab" });
      continue;
    }
    const result = parseSheet(ws);
    if ("reason" in result) {
      plan.skipped.push({ sheet: ws.name, reason: result.reason });
      continue;
    }
    const key = result.business_name.toLowerCase();
    const first = names.get(key);
    if (first) {
      plan.skipped.push({ sheet: ws.name, reason: `same business name as tab "${first}"` });
      continue;
    }
    names.set(key, ws.name);
    plan.leads.push(result);
  }
  return plan;
}
