import { describe, expect, it } from "vitest";
import { CsvError } from "./csv";
import { IMPORT_TEMPLATE, ImportFileError, importSummary, parseImportDate, planImport, type ImportContext } from "./lead-import";

const HEAD = "Business name,Website,Industry,Location,Status,Next email due,Contact name,Job title,Email";
const context: ImportContext = {
  leads: [{ business_name: "Existing Ltd" }],
  contacts: [{ email: " Saved@Old.co.uk ", lead_name: "Old Co" }],
  locations: [
    { code: "UK", label: "United Kingdom", data4seo_location_code: 2826 },
    { code: "LON", label: "London", data4seo_location_code: 1006886 },
  ],
};
const plan = (...lines: string[]) => planImport([HEAD, ...lines].join("\n"), context);
const outcome = (p: ReturnType<typeof plan>) => p.rows.map((r) => [r.line, r.status, r.message]);

describe("planImport - building leads", () => {
  it("groups rows by business name (any case or spacing) and normalises the lead fields", () => {
    const p = plan(
      "Acme Ltd,https://www.Acme.co.uk/about,Cleaning,london,Paused,02/11/2026,Ann Lee,Director,ann@acme.co.uk",
      " acme  LTD ,,,,,,Bob Ray,,bob@acme.co.uk",
      "Solo Co,,,,,,,,",
    );
    expect(outcome(p)).toEqual([
      [2, "ready", null],
      [3, "ready", null],
      [4, "ready", null],
    ]);
    expect(p.leads).toEqual([
      {
        business_name: "Acme Ltd",
        website_domain: "acme.co.uk",
        industry: "Cleaning",
        location_code: "LON",
        status: "paused",
        next_email_due: "2026-11-02",
        contacts: [
          { name: "Ann Lee", job_title: "Director", email: "ann@acme.co.uk" },
          { name: "Bob Ray", job_title: null, email: "bob@acme.co.uk" },
        ],
      },
      { business_name: "Solo Co", website_domain: null, industry: null, location_code: null, status: "active", next_email_due: null, contacts: [] },
    ]);
  });

  it("takes lead details from whichever row has them, and a repeated identical value is not a conflict", () => {
    const p = plan("Acme,,,,,,Ann,,ann@a.co", "Acme,,Cleaning,UK,active,2026-11-02,Bob,,bob@a.co", "Acme,,Cleaning,United Kingdom,ACTIVE,2/11/2026,,,");
    expect(p.rows.every((r) => r.status === "ready")).toBe(true);
    expect(p.leads[0]).toMatchObject({ industry: "Cleaning", location_code: "UK", status: "active", next_email_due: "2026-11-02" });
  });

  it("matches headings by name in any order and case, with common aliases, and lists the columns it ignores", () => {
    const p = planImport("E-mail Address, Notes ,company,NAME,\nann@a.co,call Tuesday,Acme,Ann,x", context);
    expect(p.ignoredColumns).toEqual(["Notes"]);
    expect(p.leads[0]).toMatchObject({ business_name: "Acme", contacts: [{ name: "Ann", job_title: null, email: "ann@a.co" }] });
    expect(p.headers).toEqual(["E-mail Address", " Notes ", "company", "NAME", ""]);
  });

  it("shows every cell as it was in the file, untrimmed", () => {
    const p = plan(" Acme , x.co ,,,,,,,");
    expect(p.rows[0]!.cells).toEqual([" Acme ", " x.co ", "", "", "", "", "", "", ""]);
  });

  it("numbers rows as the spreadsheet does: blank rows still count and a multi-line cell is one row", () => {
    const p = plan(",,,,,,,,", 'Acme,,"two\nlines",,,,,,', "Beta,,,,,,,,");
    expect(p.rows.map((r) => r.line)).toEqual([3, 4]);
  });

  it("the template's headings map to every column", () => {
    const p = planImport(`${IMPORT_TEMPLATE}Acme,a.co,Cleaning,UK,converted,2026-01-31,Ann,CEO,ann@a.co\r\n`, context);
    expect(p.ignoredColumns).toEqual([]);
    expect(p.leads[0]).toEqual({
      business_name: "Acme",
      website_domain: "a.co",
      industry: "Cleaning",
      location_code: "UK",
      status: "converted",
      next_email_due: "2026-01-31",
      contacts: [{ name: "Ann", job_title: "CEO", email: "ann@a.co" }],
    });
  });
});

describe("planImport - duplicate emails", () => {
  it("skips an email already used on an earlier row, in any case, even for another lead", () => {
    const p = plan("Acme,,,,,,Ann,,ann@a.co", "Beta,,,,,,Ann B,,ANN@A.CO ");
    expect(outcome(p)[1]).toEqual([3, "duplicate", "Same email as row 2 - contact skipped"]);
    expect(p.leads.map((l) => l.business_name)).toEqual(["Acme"]);
  });

  it("the earlier row in the file wins, not the lead listed first", () => {
    const p = plan("Acme,,,,,,,,", "Beta,,,,,,Bo,,x@a.co", "Acme,,,,,,Al,,x@a.co");
    expect(outcome(p)).toEqual([
      [2, "ready", null],
      [3, "ready", null],
      [4, "duplicate", "Same email as row 3 - contact skipped"],
    ]);
    expect(p.leads.find((l) => l.business_name === "Acme")!.contacts).toEqual([]);
  });

  it.each([
    ["an existing lead", "Existing Ltd,,,,,,Ann,,ann@new.co", "duplicate"],
    ["a row without a business name", ",,,,,,Ann,,ann@new.co", "error"],
    ["a lead with an error", "Bad Co,,,Leeds,,,Ann,,ann@new.co", "error"],
    ["a contact that does not fit", "Big Co,,,,,,Ann,,ann@new.co", "error"],
  ])("an email on a skipped row of %s is not a duplicate for a later row", (_, skipped, skippedStatus) => {
    const full = [1, 2, 3, 4, 5].map((n) => `Big Co,,,,,,P${n},,p${n}@a.co`);
    const p = plan(...full, skipped, "New Co,,,,,,Ann,,ANN@new.co");
    expect(p.rows.at(-2)!.status).toBe(skippedStatus);
    expect(outcome(p).at(-1)).toEqual([8, "ready", null]);
    expect(p.leads.find((l) => l.business_name === "New Co")!.contacts).toEqual([{ name: "Ann", job_title: null, email: "ANN@new.co" }]);
  });

  it("a later row is a duplicate of the row that imports the email, not of an earlier skipped one", () => {
    const p = plan("Existing Ltd,,,,,,Ann,,ann@new.co", "New Co,,,,,,Ann,,ann@new.co", "Third Co,,,,,,Ann,,ann@new.co");
    expect(outcome(p).slice(1)).toEqual([
      [3, "ready", null],
      [4, "duplicate", "Same email as row 3 - contact skipped"],
    ]);
  });

  it("skips an email already saved on any lead, naming that lead", () => {
    const p = plan("Acme,,,,,,Sam,, saved@old.co.uk ", "Acme,,,,,,Ann,,ann@a.co");
    expect(outcome(p)[0]).toEqual([2, "duplicate", "Email already saved for Old Co - contact skipped"]);
    expect(p.leads[0]!.contacts).toEqual([{ name: "Ann", job_title: null, email: "ann@a.co" }]);
  });

  it("does not import a lead whose rows are all duplicates", () => {
    expect(plan("Acme,,,,,,Sam,,saved@old.co.uk").leads).toEqual([]);
  });

  it("skips every row of a lead that already exists (any case or spacing)", () => {
    const p = plan(" existing  LTD ,,,,,,Ann,,ann@a.co", "Existing Ltd,,,,,,,,");
    expect(outcome(p)).toEqual([
      [2, "duplicate", "Lead already exists - add new contacts on its page"],
      [3, "duplicate", "Lead already exists - add new contacts on its page"],
    ]);
    expect(p.leads).toEqual([]);
  });
});

describe("planImport - row errors", () => {
  it.each([
    ["Ann,,", "A contact needs both a name and an email"],
    [",,ann@a.co", "A contact needs both a name and an email"],
    [",CEO,", "A contact needs both a name and an email"],
    ["Ann,,ann@a", '"ann@a" is not a valid email'],
  ])("contact %s is an error, and the lead still imports from its other rows", (contact, message) => {
    const p = plan(`Acme,,,,,,${contact}`, "Acme,,,,,,Bo,,bo@a.co");
    expect(outcome(p)[0]).toEqual([2, "error", message]);
    expect(p.leads[0]!.contacts).toEqual([{ name: "Bo", job_title: null, email: "bo@a.co" }]);
  });

  it.each([
    ["https://,,,,", '"https://" is not a website'],
    [",,Leeds,,", 'Unknown location "Leeds"'],
    [",,,pending,", "Status must be active, paused or converted"],
    [",,,,31/02/2026", 'Next email due "31/02/2026" is not a date - use YYYY-MM-DD or DD/MM/YYYY'],
    [",,,,next week", 'Next email due "next week" is not a date - use YYYY-MM-DD or DD/MM/YYYY'],
  ])("lead value %s is an error that blocks the whole lead", (leadCells, message) => {
    const p = plan("Acme,,,,,,Bo,,bo@a.co", `Acme,${leadCells},,,`, "Beta,,,,,,,,");
    expect(outcome(p)).toEqual([
      [2, "error", "Lead has an error on row 3"],
      [3, "error", message],
      [4, "ready", null],
    ]);
    expect(p.leads.map((l) => l.business_name)).toEqual(["Beta"]);
  });

  it("rows without an error of their own point at the lead's first error row", () => {
    const p = plan("Acme,,,,,,Bo,,bo@a.co", "Acme,,,Leeds,,,,,", "Acme,,,,pending,,,,");
    expect(outcome(p)[0]).toEqual([2, "error", "Lead has an error on row 3"]);
  });

  it("reports a lead error and a contact error on the same row together", () => {
    const p = plan("Acme,,,Leeds,,,Ann,,");
    expect(outcome(p)).toEqual([[2, "error", 'Unknown location "Leeds"; A contact needs both a name and an email']]);
  });

  it("keeps a contact error on rows blocked by another row's lead error", () => {
    const p = plan("Acme,,,Leeds,,,,,", "Acme,,,,,,Ann,,");
    expect(outcome(p)[1]).toEqual([3, "error", "Lead has an error on row 2; A contact needs both a name and an email"]);
  });

  it.each([
    ["Website", "Acme,a.co,,,,,,,", "Acme,b.co,,,,,,,"],
    ["Industry", "Acme,,Cleaning,,,,,,", "Acme,,Scaffolding,,,,,,"],
    ["Location", "Acme,,,UK,,,,,", "Acme,,,LON,,,,,"],
    ["Status", "Acme,,,,active,,,,", "Acme,,,,paused,,,,"],
    ["Next email due", "Acme,,,,,2026-11-02,,,", "Acme,,,,,2026-11-03,,,"],
  ])("rows of one lead that disagree on %s block the lead", (label, first, second) => {
    const p = plan(first, second);
    expect(outcome(p)).toEqual([
      [2, "error", "Lead has an error on row 3"],
      [3, "error", `${label} differs from row 2`],
    ]);
    expect(p.leads).toEqual([]);
  });

  it("a row without a business name is an error", () => {
    expect(outcome(plan(",,,,,,Ann,,ann@a.co"))).toEqual([[2, "error", "Business name is missing"]]);
  });

  it("caps a lead at five contacts; skipped duplicates do not use up a place", () => {
    const rows = ["Acme,,,,,,Sam,,saved@old.co.uk", ...[1, 2, 3, 4, 5, 6].map((n) => `Acme,,,,,,P${n},,p${n}@a.co`)];
    const p = plan(...rows);
    expect(p.rows.map((r) => r.status)).toEqual(["duplicate", "ready", "ready", "ready", "ready", "ready", "error"]);
    expect(p.rows[6]!.message).toBe("More than 5 contacts for this lead");
    expect(p.leads[0]!.contacts.map((c) => c.name)).toEqual(["P1", "P2", "P3", "P4", "P5"]);
  });
});

describe("planImport - file problems", () => {
  it.each([
    ["", "The file is empty"],
    ["\n , \n", "The file is empty"],
    ["Contact name,Email\nAnn,ann@a.co", 'No "Business name" column - the first row must hold the column headings'],
    ["Acme Ltd,Ann\nBeta,Bo", 'No "Business name" column - the first row must hold the column headings'],
    [`${HEAD}\n,,\n`, "The file has column headings but no rows"],
    ["Business name,Email,Contact email\nAcme,a@a.co,b@a.co", 'Columns "Email" and "Contact email" both look like Email'],
  ])("%j is refused", (text, message) => {
    expect(() => planImport(text, context)).toThrow(ImportFileError);
    expect(() => planImport(text, context)).toThrow(message);
  });

  it("a broken quote is reported as a CSV error", () => {
    expect(() => planImport(`${HEAD}\n"Acme,,,`, context)).toThrow(CsvError);
  });
});

describe("parseImportDate", () => {
  it.each([
    ["2026-11-02", "2026-11-02"],
    ["2026-1-5", "2026-01-05"],
    ["02/11/2026", "2026-11-02"],
    ["2/1/2026", "2026-01-02"],
    ["29/02/2028", "2028-02-29"],
  ])("%s -> %s", (text, expected) => {
    expect(parseImportDate(text)).toBe(expected);
  });

  it.each(["29/02/2027", "2026-02-30", "2026-13-01", "32/01/2026", "00/01/2026", "2/1/26", "2026/01/02", " 2026-01-02", "2026-01-02x", "x02/11/2026", "02/11/2026x"])("%s is not a date", (text) => {
    expect(parseImportDate(text)).toBeNull();
  });
});

describe("importSummary", () => {
  it("counts rows by outcome and what will be created", () => {
    const p = plan("Acme,,,,,,Ann,,ann@a.co", "Acme,,,,,,Bo,,bo@a.co", "Acme,,,,,,Cy,,cy@a.co", "Beta,,,,,,Sam,,saved@old.co.uk", "Beta,,,,,,,,", ",,,,,,,,x");
    expect(importSummary(p)).toEqual({ ready: 4, duplicate: 1, error: 1, leads: 2, contacts: 3 });
  });
});
