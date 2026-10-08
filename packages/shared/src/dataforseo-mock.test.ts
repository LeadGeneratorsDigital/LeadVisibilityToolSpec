import { describe, expect, it } from "vitest";
import { buildSerpTask, extractOrganicRank } from "./dataforseo";
import { buildMockSerpResponse, MOCK_TASK_ERRORS, mockOrganicRank } from "./dataforseo-mock";

const task = buildSerpTask("contract cleaning services london", 1006886);
const never = () => 0.99;

describe("buildMockSerpResponse", () => {
  it("round-trips through the real parser to the mock's own rank", () => {
    const month = "2026-10-01";
    const expected = mockOrganicRank(task.keyword, "brightclean.co.uk", month) ?? 101;
    const res = buildMockSerpResponse(task, { targetDomain: "brightclean.co.uk", month, errorRate: 0.05, random: never });
    expect(extractOrganicRank(res, "brightclean.co.uk")).toEqual({ kind: "ranked", position: expected });
  });

  it("is deterministic for the same keyword, domain and month", () => {
    const opts = { targetDomain: "brightclean.co.uk", month: "2026-10-01", errorRate: 0, random: never, taskId: "fixed" };
    const a = buildMockSerpResponse(task, opts);
    const b = buildMockSerpResponse(task, opts);
    expect(a.tasks?.[0]?.result?.[0]?.items).toEqual(b.tasks?.[0]?.result?.[0]?.items);
  });

  it("matches the live envelope: top-level 20000 with the error on the task", () => {
    const res = buildMockSerpResponse(task, { targetDomain: "x.co.uk", month: "2026-10-01", errorRate: 1, random: () => 0 });
    expect(res.status_code).toBe(20000);
    expect(res.tasks_error).toBe(1);
    expect(res.tasks?.[0]?.status_code).toBe(MOCK_TASK_ERRORS[0]!.code);
    expect(extractOrganicRank(res, "x.co.uk")).toMatchObject({ kind: "error", fatal: false });
  });

  it("organic rank_group runs 1..100 with no gaps and the lead appears at most once", () => {
    const res = buildMockSerpResponse(task, { targetDomain: "brightclean.co.uk", month: "2026-10-01", errorRate: 0, random: never });
    const organic = res.tasks![0]!.result![0]!.items!.filter((i) => i.type === "organic");
    expect(organic.map((i) => i.rank_group)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
    expect(organic.filter((i) => i.domain.endsWith("brightclean.co.uk")).length).toBeLessThanOrEqual(1);
  });
});

describe("mockOrganicRank distribution", () => {
  it("covers every visibility band and the absent case across many phrases", () => {
    const ranks = Array.from({ length: 400 }, (_, i) => mockOrganicRank(`phrase ${i}`, "brightclean.co.uk", "2026-10-01"));
    expect(ranks.some((r) => r !== null && r <= 20)).toBe(true);
    expect(ranks.some((r) => r !== null && r > 20 && r <= 50)).toBe(true);
    expect(ranks.some((r) => r !== null && r > 50)).toBe(true);
    expect(ranks.some((r) => r === null)).toBe(true);
    expect(ranks.every((r) => r === null || (r >= 1 && r <= 100))).toBe(true);
  });
});
