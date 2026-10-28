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
  const tds = [...body.matchAll(/<td(?: [^>]*)?>(.*?)<\/td>|<td[^>]*\/>/g)].slice(1);
  return {
    months,
    cells: tds.map((m) => {
      const label = /aria-label="([^"]*)"/.exec(m[0])?.[1];
      const text = (m[1] ?? "").replace(/<[^>]+>/g, "").trim();
      const tone = /bg-(visible|partly|invisible)-soft/.exec(m[0])?.[1] ?? null;
      return [label ?? text, tone];
    }),
  };
}

describe("RankingTable", () => {
  it("shows the position up to 100 in the band colour, and Not Ranked in red past it", () => {
    const { cells: row } = cells([
      { phrase_id: "p", month: "2026-06-01", position: 20 },
      { phrase_id: "p", month: "2026-07-01", position: 21 },
      { phrase_id: "p", month: "2026-08-01", position: 100 },
      { phrase_id: "p", month: "2026-09-01", position: 101 },
    ]);
    expect(row).toEqual([
      ["20", "visible"],
      ["21", "partly"],
      ["100", "partly"],
      ["Not Ranked", "invisible"],
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
      ["12", "visible"],
      ["Not checked", null],
      ["No data - the check failed", null],
    ]);
  });
});
