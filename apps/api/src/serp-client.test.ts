import { buildSerpTask, extractOrganicRank } from "@lvt/shared";
import { describe, expect, it } from "vitest";
import { createLiveSerpClient, createMockSerpClient, LIVE_ENDPOINT, SANDBOX_ENDPOINT } from "./serp-client";
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

  it("sandbox sends the same request, with the same login, to the sandbox host", async () => {
    const fake = fakeFetch(200, serpWithOrganic(["lead.co.uk"]));
    const client = createLiveSerpClient("me@x.com", "pw", fake.impl, 1000, "sandbox");
    await client.fetchSerp(task, ctx);
    const { url, init } = fake.calls[0]!;
    expect(url).toBe("https://sandbox.dataforseo.com/v3/serp/google/organic/live/regular");
    expect(SANDBOX_ENDPOINT).toBe(url);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("me@x.com:pw").toString("base64")}`);
    expect(JSON.parse(init.body as string)).toEqual([task]);
    expect(client.mode).toBe("sandbox");
    expect(LIVE_ENDPOINT).toBe("https://api.dataforseo.com/v3/serp/google/organic/live/regular");
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

  it("an error body's own status code wins over the HTTP code, so an unverified account stops the pull", async () => {
    const body = { status_code: 40104, status_message: "Please verify your account before using the API." };
    const res = await createLiveSerpClient("a", "b", fakeFetch(403, body).impl).fetchSerp(task, ctx);
    expect(res).toMatchObject({ status_code: 40104, status_message: body.status_message });
    expect(extractOrganicRank(res, "lead.co.uk")).toMatchObject({ kind: "error", fatal: true, statusCode: 40104 });
  });

  it.each([
    ["a non-JSON body", "<html>Bad gateway</html>"],
    ["a body with no status code", { oops: true }],
    ["a body claiming success", { status_code: 20000, status_message: "Ok." }],
  ])("falls back to the HTTP code for %s", async (_label, body) => {
    const impl = (async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 502 })) as unknown as typeof fetch;
    const res = await createLiveSerpClient("a", "b", impl).fetchSerp(task, ctx);
    expect(res).toMatchObject({ status_code: 50000, status_message: "HTTP 502" });
  });

  it("uses the HTTP message when the error body has a code but no message", async () => {
    const res = await createLiveSerpClient("a", "b", fakeFetch(403, { status_code: 40104 }).impl).fetchSerp(task, ctx);
    expect(res).toMatchObject({ status_code: 40104, status_message: "HTTP 403" });
  });
});

describe("reusable", () => {
  it("live results can be shared across leads; mock results are built around one lead and cannot", () => {
    expect(createLiveSerpClient("a", "b").reusable).toBe(true);
    expect(createLiveSerpClient("a", "b").mode).toBe("live");
    expect(createMockSerpClient({ errorRate: 0, latencyMs: 0 }).reusable).toBe(false);
  });

  it("sandbox dummy results are never saved for reuse, so switching to live checks for real", () => {
    expect(createLiveSerpClient("a", "b", fetch, 1000, "sandbox").reusable).toBe(false);
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
