import type { SerpResponse } from "@lvt/shared";
import { buildSerpTask, extractOrganicRank } from "@lvt/shared";
import { describe, expect, it } from "vitest";
import converted from "./fixtures/goto-converter.json";
import { createLiveSerpClient, createMockSerpClient, GOTO_BATCH_SIZE, GOTO_CONVERTER_ENDPOINT, LIVE_ENDPOINT, SANDBOX_ENDPOINT } from "./serp-client";
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

describe("GoTo links", () => {
  const goto = (n: number) => `https://google.com/goto?url=CAES${n}`;
  /** Results 1..n are GoTo links; even ranks show their site in the breadcrumb, odd ranks (videos) do not. */
  function gotoSerp(n: number): SerpResponse {
    const serp = serpWithOrganic(Array.from({ length: n }, () => "google.com"));
    for (const item of serp.tasks![0]!.result![0]!.items!) {
      item.url = goto(item.rank_group);
      item.breadcrumb = item.rank_group % 2 === 0 ? `https://www.site${item.rank_group}.co.uk › page` : "1.5k+ views  ·  2 years ago";
    }
    return serp;
  }
  const converterAnswer = (urls: string[], toUrl = (u: string) => `https://www.video${u.slice(u.lastIndexOf("S") + 1)}.com/watch`) => ({
    status_code: 20000,
    tasks: [{ status_code: 20000, result: urls.map((u) => ({ goto: u, url: toUrl(u) })) }],
  });

  /** Answers the SERP call with `serp`, then each converter call with `answer(sent urls)`. */
  function scripted(serp: SerpResponse, answer: (urls: string[]) => { status: number; body: unknown } | Error) {
    const sent: string[][] = [];
    const state = { inFlight: 0, peak: 0 };
    const impl = (async (url: string, init: RequestInit) => {
      if (url !== GOTO_CONVERTER_ENDPOINT) return new Response(JSON.stringify(serp), { status: 200 });
      const urls = (JSON.parse(init.body as string) as Array<{ goto_urls: string[] }>)[0]!.goto_urls;
      sent.push(urls);
      expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("a:b").toString("base64")}`);
      state.peak = Math.max(state.peak, ++state.inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      state.inFlight--;
      const out = answer(urls);
      if (out instanceof Error) throw out;
      return new Response(JSON.stringify(out.body), { status: out.status });
    }) as unknown as typeof fetch;
    return { sent, state, impl };
  }

  it("sends only the links the breadcrumb cannot name, 10 per call, and ranks the converted sites", async () => {
    const fake = scripted(gotoSerp(24), (urls) => ({ status: 200, body: converterAnswer(urls) }));
    const res = await createLiveSerpClient("a", "b", fake.impl).fetchSerp(task, ctx);
    expect(GOTO_BATCH_SIZE).toBe(10);
    expect(fake.sent).toEqual([[1, 3, 5, 7, 9, 11, 13, 15, 17, 19].map(goto), [21, 23].map(goto)]);
    expect(fake.state.peak).toBe(1);
    expect(extractOrganicRank(res, "video21.com")).toEqual({ kind: "ranked", position: 21 });
    expect(extractOrganicRank(res, "site24.co.uk")).toEqual({ kind: "ranked", position: 24 });
    expect(extractOrganicRank(res, "absent.co.uk")).toEqual({ kind: "ranked", position: 101 });
  });

  it("reads DataForSEO's real converter answer", async () => {
    const urls = converted.tasks[0]!.result.map((pair) => pair.goto);
    const serp = serpWithOrganic(urls.map(() => "google.com"));
    serp.tasks![0]!.result![0]!.items!.forEach((item, i) => (item.url = urls[i]!));
    const fake = scripted(serp, () => ({ status: 200, body: converted }));
    const res = await createLiveSerpClient("a", "b", fake.impl).fetchSerp(task, ctx);
    expect(extractOrganicRank(res, "mws.ltd.uk")).toEqual({ kind: "ranked", position: 1 });
    expect(extractOrganicRank(res, "youtube.com")).toEqual({ kind: "ranked", position: 4 });
  });

  it.each([
    ["HTTP 500", () => ({ status: 500, body: { status_code: 20000, tasks: [{ status_code: 50000, result: null }] } })],
    ["a task error", () => ({ status: 200, body: { status_code: 20000, tasks: [{ status_code: 50000, result: null }] } })],
    ["a network error", () => new Error("socket hang up")],
    ["a destination that is still a GoTo link", (urls: string[]) => ({ status: 200, body: converterAnswer(urls, (u) => u) })],
  ])("after %s the links stay unread: a hit still ranks, a miss is blank", async (_label, answer) => {
    const fake = scripted(gotoSerp(4), answer);
    const res = await createLiveSerpClient("a", "b", fake.impl).fetchSerp(task, ctx);
    expect(fake.sent).toEqual([[goto(1), goto(3)]]);
    expect(extractOrganicRank(res, "site2.co.uk")).toEqual({ kind: "ranked", position: 2 });
    expect(extractOrganicRank(res, "absent.co.uk")).toMatchObject({ kind: "error", statusCode: 0, fatal: false });
  });

  it.each([
    ["HTTP 500", () => ({ status: 500, body: {} })],
    ["a network error", () => new Error("socket hang up")],
  ])("a batch lost to %s does not stop the next", async (_label, failure) => {
    let call = 0;
    const fake = scripted(gotoSerp(24), (urls) => (call++ === 0 ? failure() : { status: 200, body: converterAnswer(urls) }));
    const res = await createLiveSerpClient("a", "b", fake.impl).fetchSerp(task, ctx);
    expect(fake.sent).toHaveLength(2);
    expect(extractOrganicRank(res, "video1.com")).toMatchObject({ kind: "error" });
    expect(extractOrganicRank(res, "video23.com")).toEqual({ kind: "ranked", position: 23 });
  });

  it("a converter that never answers is cut off by the timeout and leaves its links unread", async () => {
    const impl = ((url: string, init: RequestInit) =>
      url === GOTO_CONVERTER_ENDPOINT
        ? new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(init.signal!.reason)))
        : Promise.resolve(new Response(JSON.stringify(gotoSerp(2)), { status: 200 }))) as unknown as typeof fetch;
    const res = await createLiveSerpClient("a", "b", impl, 20).fetchSerp(task, ctx);
    expect(extractOrganicRank(res, "site2.co.uk")).toEqual({ kind: "ranked", position: 2 });
    expect(extractOrganicRank(res, "absent.co.uk")).toMatchObject({ kind: "error", statusCode: 0 });
  }, 1000);

  it("makes no converter call when every site can be read, nor in sandbox", async () => {
    const readable = scripted(serpWithOrganic(["lead.co.uk"]), () => new Error("must not be called"));
    await createLiveSerpClient("a", "b", readable.impl).fetchSerp(task, ctx);
    const sandbox = scripted(gotoSerp(3), () => new Error("must not be called"));
    await createLiveSerpClient("a", "b", sandbox.impl, 1000, "sandbox").fetchSerp(task, ctx);
    expect([...readable.sent, ...sandbox.sent]).toEqual([]);
  });
});
