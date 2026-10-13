import { buildSerpTask, extractOrganicRank } from "@lvt/shared";
import { describe, expect, it } from "vitest";
import { createLiveSerpClient, createMockSerpClient, LIVE_ENDPOINT } from "./serp-client";
import { serpWithOrganic } from "./test-support";

const task = buildSerpTask("scaffolding hire london", 1006886);
const ctx = { targetDomain: "lead.co.uk", month: "2026-10-01" };

function fakeFetch(status: number, body: unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

describe("createLiveSerpClient", () => {
  it("POSTs a one-task array with Basic auth to the live regular endpoint", async () => {
    const fake = fakeFetch(200, serpWithOrganic(["lead.co.uk"]));
    await createLiveSerpClient("me@x.com", "pw", fake.impl).fetchSerp(task, ctx);
    const { url, init } = fake.calls[0]!;
    expect(url).toBe(LIVE_ENDPOINT);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("me@x.com:pw").toString("base64")}`);
    expect(JSON.parse(init.body as string)).toEqual([task]);
  });

  it.each([
    [401, 40100, true],
    [402, 40200, true],
    [500, 50000, false],
  ])("HTTP %i maps to status %i (fatal=%s)", async (http, code, fatal) => {
    const res = await createLiveSerpClient("a", "b", fakeFetch(http, { oops: true }).impl).fetchSerp(task, ctx);
    expect(res.status_code).toBe(code);
    expect(extractOrganicRank(res, "lead.co.uk")).toMatchObject({ kind: "error", fatal });
  });
});

describe("reusable", () => {
  it("live results can be shared across leads; mock results are built around one lead and cannot", () => {
    expect(createLiveSerpClient("a", "b").reusable).toBe(true);
    expect(createMockSerpClient({ errorRate: 0, latencyMs: 0 }).reusable).toBe(false);
  });
});

describe("createMockSerpClient", () => {
  it("returns a response the real parser accepts", async () => {
    const client = createMockSerpClient({ errorRate: 0, latencyMs: 0, random: () => 0.5 });
    expect(extractOrganicRank(await client.fetchSerp(task, ctx), "lead.co.uk").kind).toBe("ranked");
  });
});

describe("createLiveSerpClient timeout", () => {
  it("aborts a request that never answers", async () => {
    const hang = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(init.signal!.reason)))) as unknown as typeof fetch;
    await expect(createLiveSerpClient("a", "b", hang, 20).fetchSerp(task, ctx)).rejects.toThrow(/timeout|aborted/i);
  }, 1000);
});
