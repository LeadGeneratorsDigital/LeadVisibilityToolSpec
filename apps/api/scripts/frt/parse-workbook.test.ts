import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseMonthHeader, parseRankingCell, parseWorkbook } from "./parse-workbook";

type Line = string | { heading: string } | [string, ...unknown[]] | null;

/** A tab in the FRT layout. Phrase rows are [text, ...ranking cells from column C]; null is a blank row. */
function addTab(wb: ExcelJS.Workbook, name: string, options: { business?: string; website?: ExcelJS.CellValue; engine?: string; contacts?: Array<[string, string]>; months?: string[]; lines?: Line[] } = {}) {
  const ws = wb.addWorksheet(name);
  ws.getCell("B3").value = "BUSINESS & SETTINGS";
  ws.getCell("B4").value = options.business ?? name;
  ws.getCell("B5").value = options.website ?? { text: "https://www.lead.co.za/", hyperlink: "https://www.lead.co.za/" };
  ws.getCell("D4").value = options.engine ?? "Google SA";
  ws.getCell("D5").value = { formula: "_xludf.IFS(D4=\"Google UK\",\"UK\")", result: { error: "#NAME?" } } as ExcelJS.CellValue;
  (options.contacts ?? [["Ann Lee", "ann@lead.co.za"]]).forEach(([n, e], i) => {
    ws.getCell(9 + i, 2).value = n;
    ws.getCell(9 + i, 4).value = e;
  });
  (options.months ?? ["Aug-26", "Sep-26"]).forEach((m, i) => (ws.getCell(15, 3 + i).value = m));
  (options.lines ?? []).forEach((line, i) => {
    const r = 16 + i;
    if (line === null) return;
    if (typeof line === "object" && !Array.isArray(line)) {
      ws.getCell(r, 2).value = line.heading;
      ws.getCell(r, 2).font = { bold: true };
      return;
    }
    const [text, ...cells] = Array.isArray(line) ? line : [line];
    ws.getCell(r, 2).value = text;
    cells.forEach((v, c) => (ws.getCell(r, 3 + c).value = v as ExcelJS.CellValue));
  });
  return ws;
}

function parseOne(options: Parameters<typeof addTab>[2]) {
  const wb = new ExcelJS.Workbook();
  addTab(wb, "Lead", options);
  const plan = parseWorkbook(wb);
  expect(plan.skipped).toEqual([]);
  return plan.leads[0]!;
}

const H = (heading: string) => ({ heading });
const groupNames = (lead: ReturnType<typeof parseOne>) => lead.groups.map((g) => [g.name, g.phrases.map((p) => p.text)]);

describe("parseRankingCell", () => {
  it.each([
    [1, 1],
    [100, 100],
    ["12", 12],
    [" 7 ", 7],
    [101, 101],
    [104, 101],
    ["102", 101],
    ["Not Ranked", 101],
    [" Not Ranked", 101],
    ["not in the top 100", 101],
    ["Not in the Top 100", 101],
    [null, null],
    ["  ", null],
  ])("%j -> %j", (value, position) => {
    expect(parseRankingCell(value as ExcelJS.CellValue)).toEqual({ position });
  });

  it.each([0, -3, 2.5, "n/a", "12th", true])("%j is an error", (value) => {
    expect(parseRankingCell(value as ExcelJS.CellValue)).toHaveProperty("error");
  });

  it("reads a formula's cached result", () => {
    expect(parseRankingCell({ formula: "A1", result: 9 } as ExcelJS.CellValue)).toEqual({ position: 9 });
  });
});

describe("parseMonthHeader", () => {
  it.each([
    ["Apr-25", "2025-04-01"],
    ["dec-26", "2026-12-01"],
    [" Jan-27 ", "2027-01-01"],
    [new Date(Date.UTC(2026, 8, 1)), "2026-09-01"],
    ["Sept-26", null],
    ["Foo-26", null],
    ["EMAIL TEMPLATE", null],
    [null, null],
  ])("%j -> %j", (value, month) => {
    expect(parseMonthHeader(value as ExcelJS.CellValue)).toBe(month);
  });
});

describe("parseWorkbook - lead fields", () => {
  it("reads the name, website hyperlink, country from the search engine, and contacts", () => {
    const lead = parseOne({ business: " Example  Security ", contacts: [["Nina Patel", "nina@example-security.co.za"], ["optional", ""], ["Bo", "mailto:bo@example-security.co.za"]] });
    expect(lead).toMatchObject({
      sheet: "Lead",
      business_name: "Example Security",
      website_domain: "lead.co.za",
      location_code: "ZA",
      contacts: [
        { name: "Nina Patel", email: "nina@example-security.co.za" },
        { name: "Bo", email: "bo@example-security.co.za" },
      ],
      warnings: ["No key phrases"],
    });
  });

  it.each([
    ["Google UK", "UK"],
    ["Google USA", "US"],
    ["google sa", "ZA"],
  ])("%s -> %s", (engine, code) => {
    expect(parseOne({ engine }).location_code).toBe(code);
  });

  it.each([
    ["Jo Bloggs", 'Website "Jo Bloggs" is not a web address - left empty, so rankings cannot be updated until it is set'],
    ["Enter Website URL Here", "No website - rankings cannot be updated until it is set"],
    ["", "No website - rankings cannot be updated until it is set"],
  ])("website %j is left empty with a warning", (website, warning) => {
    const lead = parseOne({ website, lines: ["a"] });
    expect(lead.website_domain).toBeNull();
    expect(lead.warnings).toEqual([warning]);
  });

  it("leaves out a contact without a valid email, and names an email-only contact by its address", () => {
    const lead = parseOne({ contacts: [["Sam Hill", ""], ["", "x@lead.co.za"], ["Enter First Contact Here", "nope"]], lines: ["a"] });
    expect(lead.contacts).toEqual([{ name: "x@lead.co.za", email: "x@lead.co.za" }]);
    expect(lead.warnings).toEqual(["Contact on row 9 (Sam Hill) has no valid email - left out", "Contact on row 11 (no name) has no valid email - left out"]);
  });
});

describe("parseWorkbook - headings and phrases", () => {
  it("bold rows are headings; phrases above the first heading stay ungrouped", () => {
    const lead = parseOne({ lines: ["art restorer", null, H("Buyers searching North London"), "art restorer Barnet", "picture conservator Barnet"] });
    expect(groupNames(lead)).toEqual([
      [null, ["art restorer"]],
      ["Buyers searching North London", ["art restorer Barnet", "picture conservator Barnet"]],
    ]);
  });

  it("joins a stacked ALL-CAPS section onto each heading under it, keeping the same heading in two sections apart", () => {
    const lead = parseOne({
      lines: [
        H("WHAT BUYERS ARE SEARCHING FOR"),
        null,
        H("Large Commercial Property Owners"),
        "solar for offices",
        H("Property Developers"),
        "solar for new builds",
        H("QUESTIONS BUYERS ARE ASKING"),
        H("Large Commercial Property Owners"),
        "is solar worth it for offices",
      ],
    });
    expect(groupNames(lead)).toEqual([
      ["WHAT BUYERS ARE SEARCHING FOR — Large Commercial Property Owners", ["solar for offices"]],
      ["WHAT BUYERS ARE SEARCHING FOR — Property Developers", ["solar for new builds"]],
      ["QUESTIONS BUYERS ARE ASKING — Large Commercial Property Owners", ["is solar worth it for offices"]],
    ]);
    expect(lead.warnings).toEqual([]);
  });

  it("an ALL-CAPS heading with phrases directly under it ends the section above", () => {
    const lead = parseOne({ lines: [H("BUYERS WHO ARE SEARCHING\nFOR A SOLUTION"), H("Compliance"), "axle weighing", H("BUYERS WHO ARE ASKING QUESTIONS"), "what is a weighbridge"] });
    expect(groupNames(lead)).toEqual([
      ["BUYERS WHO ARE SEARCHING FOR A SOLUTION — Compliance", ["axle weighing"]],
      ["BUYERS WHO ARE ASKING QUESTIONS", ["what is a weighbridge"]],
    ]);
  });

  it("leaves out headings with no phrases, with a warning", () => {
    const lead = parseOne({ lines: [H("SECTION ONE"), H("SECTION TWO"), H("Empty"), H("Full"), "a"] });
    expect(groupNames(lead)).toEqual([["SECTION TWO — Full", ["a"]]]);
    expect(lead.warnings).toEqual(['Heading "SECTION ONE" has no phrases - left out', 'Heading "SECTION TWO — Empty" has no phrases - left out']);
  });

  it("a bold heading with no letters is an ordinary heading, never a section", () => {
    const lead = parseOne({ lines: [H("2026"), H("Next"), "a"] });
    expect(groupNames(lead)).toEqual([["Next", ["a"]]]);
    expect(lead.warnings).toEqual(['Heading "2026" has no phrases - left out']);
  });

  it("stops at five blank rows, not four", () => {
    const lead = parseOne({ lines: ["a", null, null, null, null, "b", null, null, null, null, null, "after the end"] });
    expect(lead.groups.flatMap((g) => g.phrases.map((p) => p.text))).toEqual(["a", "b"]);
  });

  it("warns about a phrase listed twice, in any case or spacing, and keeps both rows", () => {
    const lead = parseOne({ lines: [H("One"), "Heavy Lifting", H("Two"), "heavy  lifting"] });
    expect(lead.groups.map((g) => g.phrases.length)).toEqual([1, 1]);
    expect(lead.warnings).toEqual(['Phrase "heavy lifting" is listed 2 times']);
  });
});

describe("parseWorkbook - rankings", () => {
  it("stores each month's position under the first of that month, blanks left out", () => {
    const lead = parseOne({ months: ["Jun-26", "Jul-26", "Aug-26"], lines: [["a", 49, null, "Not in the Top 100"], ["b", " Not Ranked", "12"]] });
    expect(lead.groups[0]!.phrases).toEqual([
      { text: "a", rankings: [{ month: "2026-06-01", position: 49 }, { month: "2026-08-01", position: 101 }] },
      { text: "b", rankings: [{ month: "2026-06-01", position: 101 }, { month: "2026-07-01", position: 12 }] },
    ]);
    expect([lead.first_month, lead.latest_month]).toEqual(["2026-06-01", "2026-08-01"]);
  });

  it("warns about a value that is not a ranking and a ranking under no month heading", () => {
    const lead = parseOne({ months: ["Sep-26"], lines: [["a", "n/a", 5]] });
    expect(lead.groups[0]!.phrases[0]!.rankings).toEqual([]);
    expect(lead.warnings).toEqual(['Row 16, column C: "n/a" is not a ranking - left blank', "Row 16, column D: ranking under no month heading - left out"]);
  });

  it("keeps the first of two columns headed with the same month and warns about the second", () => {
    const lead = parseOne({ months: ["Aug-26", "Sep-26", "Sep-26"], lines: [["a", 3, 4, 5]] });
    expect(lead.groups[0]!.phrases[0]!.rankings).toEqual([
      { month: "2026-08-01", position: 3 },
      { month: "2026-09-01", position: 4 },
    ]);
    expect(lead.warnings).toEqual(["Column E repeats the month in column D - left out", "Row 16, column E: ranking under no month heading - left out"]);
  });

  it("has no latest month when nothing was ranked", () => {
    const lead = parseOne({ lines: ["a"] });
    expect([lead.first_month, lead.latest_month]).toEqual([null, null]);
  });
});

describe("parseWorkbook - tabs", () => {
  it("skips hidden tabs, other layouts, template tabs, unknown engines and a repeated business name", () => {
    const wb = new ExcelJS.Workbook();
    addTab(wb, "Acme Scales", { lines: ["a"] });
    addTab(wb, "Hidden").state = "hidden";
    wb.addWorksheet("All Clients").getCell("B1").value = "Business Name";
    addTab(wb, "Template", { business: "Enter Business Name Here" });
    addTab(wb, "Blank", { business: "  " });
    addTab(wb, "Odd", { engine: "Bing" });
    addTab(wb, "Acme Scales (2)", { business: "acme scales" });

    const plan = parseWorkbook(wb);
    expect(plan.leads.map((l) => l.sheet)).toEqual(["Acme Scales"]);
    expect(plan.skipped).toEqual([
      { sheet: "Hidden", reason: "hidden tab" },
      { sheet: "All Clients", reason: 'not in the "BUSINESS & SETTINGS" layout' },
      { sheet: "Template", reason: "no business name (template tab)" },
      { sheet: "Blank", reason: "no business name (template tab)" },
      { sheet: "Odd", reason: 'unknown search engine "Bing" in D4' },
      { sheet: "Acme Scales (2)", reason: 'same business name as tab "Acme Scales"' },
    ]);
  });
});
