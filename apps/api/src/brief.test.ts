import { describe, expect, it } from "vitest";
import { BRIEF_MAX_TOKENS, BRIEF_SYSTEM_PROMPT, BriefDisabledError, createClaudeBriefMerger, createDisabledBriefMerger, createMockBriefMerger } from "./brief";

function fakeMessages(content: Array<{ type: string; text?: string }>) {
  const calls: unknown[] = [];
  return {
    calls,
    api: {
      create: (async (params: unknown) => {
        calls.push(params);
        return { content };
      }) as never,
    },
  };
}

describe("createClaudeBriefMerger", () => {
  it("sends the spec section 9 request shape", async () => {
    const fake = fakeMessages([{ type: "text", text: "merged" }]);
    await createClaudeBriefMerger(fake.api, "claude-haiku-4-5").merge("Old brief.", "- met at expo");
    expect(fake.calls[0]).toEqual({
      model: "claude-haiku-4-5",
      max_tokens: BRIEF_MAX_TOKENS,
      system: BRIEF_SYSTEM_PROMPT,
      messages: [{ role: "user", content: "Existing brief: Old brief.\n\nNew notes to merge: - met at expo" }],
    });
    expect(BRIEF_MAX_TOKENS).toBe(1000);
  });

  it("joins text blocks, ignores non-text blocks and trims", async () => {
    const fake = fakeMessages([{ type: "text", text: "  Part one" }, { type: "thinking" }, { type: "text", text: " part two.\n" }]);
    expect(await createClaudeBriefMerger(fake.api, "m").merge("", "n")).toBe("Part one part two.");
  });

  it("throws on an empty reply instead of wiping the brief", async () => {
    const fake = fakeMessages([{ type: "text", text: "   " }]);
    await expect(createClaudeBriefMerger(fake.api, "m").merge("keep me", "n")).rejects.toThrow(/empty brief/);
  });
});

describe("createDisabledBriefMerger", () => {
  it("reports mode off and refuses to merge with BriefDisabledError", async () => {
    const merger = createDisabledBriefMerger();
    expect(merger.mode).toBe("off");
    await expect(merger.merge("keep me", "n")).rejects.toBeInstanceOf(BriefDisabledError);
  });
});

describe("createMockBriefMerger", () => {
  it("appends normalised bullet notes under the existing brief", async () => {
    expect(await createMockBriefMerger().merge("Existing.", "* one\n\n• two\nthree")).toBe("Existing.\n\n- one\n- two\n- three");
  });

  it("works with an empty brief", async () => {
    expect(await createMockBriefMerger().merge("  ", "note")).toBe("- note");
  });
});
