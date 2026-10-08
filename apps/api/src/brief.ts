import Anthropic from "@anthropic-ai/sdk";

/** Spec section 9, verbatim. */
export const BRIEF_SYSTEM_PROMPT =
  "You are helping a sales professional maintain a brief about a prospect. Merge the new notes into the existing brief. Keep the tone factual and concise. Return only the updated brief text, no preamble.";

export const BRIEF_MAX_TOKENS = 1000;

export function briefUserMessage(existingBrief: string, rawNotes: string): string {
  return `Existing brief: ${existingBrief}\n\nNew notes to merge: ${rawNotes}`;
}

export interface BriefMerger {
  readonly mode: "claude" | "mock";
  merge(existingBrief: string, rawNotes: string): Promise<string>;
}

type MessagesApi = Pick<Anthropic["messages"], "create">;

export function createClaudeBriefMerger(messages: MessagesApi, model: string): BriefMerger {
  return {
    mode: "claude",
    async merge(existingBrief, rawNotes) {
      const response = await messages.create({
        model,
        max_tokens: BRIEF_MAX_TOKENS,
        system: BRIEF_SYSTEM_PROMPT,
        messages: [{ role: "user", content: briefUserMessage(existingBrief, rawNotes) }],
      });
      const text = response.content
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join("")
        .trim();
      if (!text) throw new Error("Claude returned an empty brief");
      return text;
    },
  };
}

export function createAnthropicBriefMerger(apiKey: string, model: string): BriefMerger {
  return createClaudeBriefMerger(new Anthropic({ apiKey }).messages, model);
}

/** Used when ANTHROPIC_API_KEY is not set: appends the notes so the review/save flow can be demoed. */
export function createMockBriefMerger(): BriefMerger {
  return {
    mode: "mock",
    async merge(existingBrief, rawNotes) {
      const notes = rawNotes
        .split("\n")
        .map((line) => line.replace(/^\s*[-*•]\s*/, "").trim())
        .filter(Boolean)
        .map((line) => `- ${line}`)
        .join("\n");
      return [existingBrief.trim(), notes].filter(Boolean).join("\n\n");
    },
  };
}
