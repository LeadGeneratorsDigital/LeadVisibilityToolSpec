import { buildRankingGrid, historyMonths } from "@lvt/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RankingTable } from "./RankingTable";

/** Each data cell of the phrase row as [aria-label or text shown, background class]. */
function cells(rankings: Array<{ phrase_id: string; month: string; position: number | null }>) {
  const rows = buildRankingGrid([], [{ id: "p", buyer_group_id: null, phrase_text: "art restorer", is_heading: false, sort_order: 1 }], rankings);
  // useLayoutEffect only scrolls the table; it has nothing to do on the server.
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const html = renderToStaticMarkup(<RankingTable rows={rows} months={historyMonths(rankings)} />);
  error.mockRestore();
  const body = html.slice(html.indexOf("<tbody>"));
  const months = [...html.matchAll(/<th[^>]*>.*?<span[^>]*>([A-Z][a-z]{2} \d{2})/g)].map((m) => m[1]);
  const tds = [...body.matchAll(/<td(?: [^>]*)?>(.*?)<\/td>|<td[^>]*\/>/g)].slice(1).filter((m) => !m[0].includes('aria-hidden="true"'));
  return {
    months,
    cells: tds.map((m) => {
      const label = /aria-label="([^"]*)"/.exec(m[0])?.[1];
      const text = (m[1] ?? "").replace(/<[^>]+>/g, "").trim();
      // The figure's own colour class, not the trend arrow's text-*-bar or any background.
      const tone = /class="[^"]*\btext-(visible|partly|invisible)(?![\w-])/.exec(m[0])?.[1] ?? null;
      return [label ?? text, tone, /\bbg-/.test(m[0])];
    }),
  };
}

describe("RankingTable", () => {
  it("puts the month columns right after the phrases, with a filler column taking the spare width", () => {
    const rows = buildRankingGrid([], [{ id: "p", buyer_group_id: null, phrase_text: "art restorer", is_heading: false, sort_order: 1 }], [{ phrase_id: "p", month: "2026-10-01", position: 3 }]);
    const html = renderToStaticMarkup(<RankingTable rows={rows} months={historyMonths([{ phrase_id: "p", month: "2026-10-01", position: 3 }])} />);
    const ths = [...html.matchAll(/<th(\s[^>]*)?>/g)].map((m) => m[1] ?? "");
    expect(ths).toHaveLength(3);
    expect(ths[1]).toMatch(/\bw-24\b/);
    expect(ths[2]).toMatch(/aria-hidden="true"/);
    expect(ths[2]).toMatch(/\bw-full\b/);
  });

  it("shows the position up to 100 in the band colour, and Not Ranked in red past it", () => {
    const { cells: row } = cells([
      { phrase_id: "p", month: "2026-06-01", position: 20 },
      { phrase_id: "p", month: "2026-07-01", position: 21 },
      { phrase_id: "p", month: "2026-08-01", position: 100 },
      { phrase_id: "p", month: "2026-09-01", position: 101 },
    ]);
    expect(row).toEqual([
      ["20", "visible", false],
      ["21", "partly", false],
      ["100", "partly", false],
      ["Not Ranked", "invisible", false],
    ]);
  });

  it("has a column only for months rankings were taken, and leaves a month the phrase was not checked blank", () => {
    const { months, cells: row } = cells([
      { phrase_id: "p", month: "2026-03-01", position: 12 },
      { phrase_id: "other", month: "2026-06-01", position: 3 },
      { phrase_id: "p", month: "2026-09-01", position: null },
    ]);
    expect(months).toEqual(["Mar 26", "Jun 26", "Sep 26"]);
    expect(row).toEqual([
      ["12", "visible", false],
      ["Not checked", null, false],
      ["No data - the check failed", null, false],
    ]);
  });
});
