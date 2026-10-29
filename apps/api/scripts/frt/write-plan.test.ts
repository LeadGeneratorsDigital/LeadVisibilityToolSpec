import { describe, expect, it } from "vitest";
import type { FrtLead } from "./parse-workbook";
import { applyPlan, exitCode, MAX_CONSECUTIVE_FAILURES, RANKING_BATCH, writeLead, type FrtStore, type LeadResult } from "./write-plan";

type Step = "insertLead" | "insertContacts" | "insertHeading" | "insertPhrases" | "insertRankings" | "deleteLead";

/** In-memory store; `fail` names steps that throw, optionally only for one business name or on the nth call. */
class MemoryStore implements FrtStore {
  leads = new Map<string, { business_name: string; last_ranking_pull: string | null; date_added?: string }>();
  contacts: Array<{ lead_id: string; name: string; email: string; sort_order: number }> = [];
  headings: Array<{ id: string; lead_id: string; name: string; sort_order: number }> = [];
  phrases: Array<{ id: string; lead_id: string; buyer_group_id: string | null; phrase_text: string; sort_order: number }> = [];
  rankings: Array<{ phrase_id: string; month: string; position: number }> = [];
  rankingBatches: number[] = [];
  calls: Step[] = [];
  private next = 0;
  constructor(private fail: Partial<Record<Step, (lead: string) => boolean>> = {}, private reorderPhrases = false) {}
  private current = "";
  private step(step: Step) {
    this.calls.push(step);
    if (this.fail[step]?.(this.current)) throw new Error(`${step} refused`);
  }
  async insertLead(row: Parameters<FrtStore["insertLead"]>[0]) {
    this.current = row.business_name;
    this.step("insertLead");
    const id = `lead-${++this.next}`;
    this.leads.set(id, { business_name: row.business_name, last_ranking_pull: row.last_ranking_pull, ...("date_added" in row ? { date_added: row.date_added } : {}) });
    return id;
  }
  async insertContacts(rows: Parameters<FrtStore["insertContacts"]>[0]) {
    this.step("insertContacts");
    this.contacts.push(...rows);
  }
  async insertHeading(row: Parameters<FrtStore["insertHeading"]>[0]) {
    this.step("insertHeading");
    const id = `heading-${++this.next}`;
    this.headings.push({ id, ...row });
    return id;
  }
  async insertPhrases(rows: Parameters<FrtStore["insertPhrases"]>[0]) {
    this.step("insertPhrases");
    const saved = rows.map((r) => ({ id: `phrase-${++this.next}`, ...r }));
    this.phrases.push(...saved);
    const out = saved.map((r) => ({ id: r.id, sort_order: r.sort_order }));
    // PostgREST does not promise to return inserted rows in input order.
    return this.reorderPhrases ? out.reverse() : out;
  }
  async insertRankings(rows: Parameters<FrtStore["insertRankings"]>[0]) {
    this.step("insertRankings");
    this.rankingBatches.push(rows.length);
    this.rankings.push(...rows);
  }
  async deleteLead(id: string) {
    this.step("deleteLead");
    this.leads.delete(id);
    const phraseIds = new Set(this.phrases.filter((p) => p.lead_id === id).map((p) => p.id));
    this.contacts = this.contacts.filter((c) => c.lead_id !== id);
    this.headings = this.headings.filter((h) => h.lead_id !== id);
    this.phrases = this.phrases.filter((p) => p.lead_id !== id);
    this.rankings = this.rankings.filter((r) => !phraseIds.has(r.phrase_id));
  }
  phraseText(id: string) {
    return this.phrases.find((p) => p.id === id)?.phrase_text;
  }
}

function lead(name: string, overrides: Partial<FrtLead> = {}): FrtLead {
  return {
    sheet: name,
    business_name: name,
    website_domain: "lead.co.uk",
    location_code: "UK",
    contacts: [{ name: "Ann", email: "ann@lead.co.uk" }],
    groups: [
      { name: null, phrases: [{ text: "loose", rankings: [{ month: "2026-08-01", position: 9 }] }] },
      {
        name: "Heading",
        phrases: [
          { text: "first", rankings: [{ month: "2026-08-01", position: 3 }, { month: "2026-09-01", position: 101 }] },
          { text: "second", rankings: [{ month: "2026-09-01", position: 40 }] },
        ],
      },
    ],
    first_month: "2026-08-01",
    latest_month: "2026-09-01",
    warnings: [],
    ...overrides,
  };
}

const pending = (...leads: FrtLead[]): LeadResult[] => leads.map((l) => ({ sheet: l.sheet, business_name: l.business_name, outcome: "not attempted" }));

describe("writeLead", () => {
  it("writes the lead, contacts, headings, phrases in order and each ranking on its own phrase", async () => {
    const store = new MemoryStore({}, true);
    await writeLead(store, lead("Acme"));
    expect([...store.leads.values()]).toEqual([{ business_name: "Acme", last_ranking_pull: "2026-09-01T12:00:00Z", date_added: "2026-08-01" }]);
    expect(store.contacts).toEqual([{ lead_id: "lead-1", name: "Ann", email: "ann@lead.co.uk", sort_order: 1 }]);
    expect(store.headings.map((h) => [h.name, h.sort_order])).toEqual([["Heading", 2]]);
    expect(store.phrases.map((p) => [p.phrase_text, p.buyer_group_id, p.sort_order])).toEqual([
      ["loose", null, 1],
      ["first", store.headings[0]!.id, 2],
      ["second", store.headings[0]!.id, 3],
    ]);
    expect(store.rankings.map((r) => [store.phraseText(r.phrase_id), r.month, r.position])).toEqual([
      ["loose", "2026-08-01", 9],
      ["first", "2026-08-01", 3],
      ["first", "2026-09-01", 101],
      ["second", "2026-09-01", 40],
    ]);
  });

  it("leaves Last ranking update empty and Date added to the database for a lead with no rankings, and skips contacts when there are none", async () => {
    const store = new MemoryStore();
    await writeLead(store, lead("Bare", { contacts: [], groups: [], first_month: null, latest_month: null }));
    expect([...store.leads.values()]).toEqual([{ business_name: "Bare", last_ranking_pull: null }]);
    expect(store.calls).toEqual(["insertLead"]);
  });

  it("sends rankings in batches", async () => {
    const store = new MemoryStore();
    const many = Array.from({ length: RANKING_BATCH + 1 }, (_, i) => ({ month: `20${String(10 + Math.floor(i / 12)).padStart(2, "0")}-${String((i % 12) + 1).padStart(2, "0")}-01`, position: 5 }));
    await writeLead(store, lead("Big", { groups: [{ name: null, phrases: [{ text: "x", rankings: many }] }] }));
    expect(store.rankingBatches).toEqual([RANKING_BATCH, 1]);
  });

  it.each(["insertContacts", "insertHeading", "insertPhrases", "insertRankings"] as const)("removes the lead again when %s fails, and rethrows", async (step) => {
    const store = new MemoryStore({ [step]: () => true });
    await expect(writeLead(store, lead("Acme"))).rejects.toThrow(`${step} refused`);
    expect(store.calls.at(-1)).toBe("deleteLead");
    expect([store.leads.size, store.contacts.length, store.headings.length, store.phrases.length, store.rankings.length]).toEqual([0, 0, 0, 0, 0]);
  });

  it("names the lead to delete by hand when the clean-up fails too", async () => {
    const store = new MemoryStore({ insertRankings: () => true, deleteLead: () => true });
    await expect(writeLead(store, lead("Acme"))).rejects.toThrow('insertRankings refused - and removing the half-written lead failed (deleteLead refused); delete "Acme" by hand');
  });

  it("fails, and cleans up, when a phrase comes back without an id", async () => {
    const store = new MemoryStore();
    store.insertPhrases = async () => [];
    await expect(writeLead(store, lead("Acme"))).rejects.toThrow('Insert phrases: "loose" came back without an id');
    expect(store.leads.size).toBe(0);
  });
});

describe("applyPlan", () => {
  it("imports every pending lead, skips the others, and saves after each", async () => {
    const store = new MemoryStore();
    const results: LeadResult[] = [...pending(lead("A")), { sheet: "B", business_name: "B", outcome: "already exists" }, ...pending(lead("C"))];
    const saved: string[] = [];
    const stopped = await applyPlan(store, [lead("A"), lead("B"), lead("C")], results, (r) => saved.push(`${r.business_name}:${r.outcome}`));
    expect(stopped).toBe(false);
    expect(saved).toEqual(["A:imported", "C:imported"]);
    expect(results.map((r) => r.outcome)).toEqual(["imported", "already exists", "imported"]);
    expect([...store.leads.values()].map((l) => l.business_name)).toEqual(["A", "C"]);
  });

  it(`stops after ${MAX_CONSECUTIVE_FAILURES} failed leads in a row and leaves the rest not attempted`, async () => {
    const leads = ["A", "B", "C", "D", "E"].map((n) => lead(n));
    const store = new MemoryStore({ insertLead: () => true });
    const results = pending(...leads);
    expect(await applyPlan(store, leads, results, () => {})).toBe(true);
    expect(results.map((r) => r.outcome)).toEqual(["failed", "failed", "failed", "not attempted", "not attempted"]);
    expect(store.calls.filter((c) => c === "insertLead")).toHaveLength(MAX_CONSECUTIVE_FAILURES);
    expect(results[0]!.error).toBe("insertLead refused");
  });

  it("a success in between resets the count", async () => {
    const leads = ["A", "B", "ok", "C", "D", "E"].map((n) => lead(n));
    const store = new MemoryStore({ insertLead: (name) => name !== "ok" });
    const results = pending(...leads);
    expect(await applyPlan(store, leads, results, () => {})).toBe(false);
    expect(results.map((r) => r.outcome)).toEqual(["failed", "failed", "imported", "failed", "failed", "failed"]);
  });
});

describe("exitCode", () => {
  it.each([
    [["imported", "already exists", "would import"], 0],
    [["imported", "failed"], 1],
    [["imported", "not attempted"], 1],
  ] as const)("%j -> %i", (outcomes, code) => {
    expect(exitCode(outcomes.map((outcome) => ({ sheet: "s", business_name: "b", outcome })))).toBe(code);
  });
});
