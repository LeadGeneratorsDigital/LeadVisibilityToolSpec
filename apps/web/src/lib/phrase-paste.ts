import { keywordKey } from "@lvt/shared";

export type PastedLine =
  | { kind: "heading"; name: string; existing: boolean }
  | { kind: "phrase"; text: string; heading: string | null; skip: "tracked" | "repeated" | null };

export interface PastePlan {
  lines: PastedLine[];
  newHeadings: string[];
  phrasesToAdd: number;
}

/** Bullets and list numbers people paste along with a list: "- ", "• ", "* ", "1. ", "2) ". */
const LIST_MARKER = /^(?:[-–•*]\s+|\d+[.)]\s+)/;

/** Pasted text loses bold, so a heading is a line ending in ":" or written in capitals. */
function headingName(line: string): string | null {
  if (line.endsWith(":")) return line.slice(0, -1).trim() || null;
  const letters = line.replace(/[^A-Za-z]/g, "");
  return letters.length >= 2 && letters === letters.toUpperCase() ? line : null;
}

/**
 * Reads a pasted list into headings and key phrases, in order. A heading that matches an existing
 * one (any case or spacing) is reused; phrases above the first heading go under no heading. A phrase
 * the lead already tracks, or one repeated in the list, is shown but not added.
 */
export function planPhrasePaste(text: string, existing: { headings: string[]; phrases: string[] }): PastePlan {
  const knownHeadings = new Set(existing.headings.map(keywordKey));
  const seen = new Set(existing.phrases.map(keywordKey));
  const tracked = new Set(seen);
  const newHeadings: string[] = [];
  const lines: PastedLine[] = [];
  let heading: string | null = null;
  let phrasesToAdd = 0;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(LIST_MARKER, "").replace(/\s+/g, " ").trim();
    if (!line) continue;
    const name = headingName(line);
    if (name) {
      const key = keywordKey(name);
      const isExisting = knownHeadings.has(key);
      if (!isExisting && !newHeadings.some((h) => keywordKey(h) === key)) newHeadings.push(name);
      heading = existing.headings.find((h) => keywordKey(h) === key) ?? newHeadings.find((h) => keywordKey(h) === key)!;
      lines.push({ kind: "heading", name: heading, existing: isExisting });
      continue;
    }
    const key = keywordKey(line);
    const skip = tracked.has(key) ? "tracked" : seen.has(key) ? "repeated" : null;
    seen.add(key);
    if (!skip) phrasesToAdd++;
    lines.push({ kind: "phrase", text: line, heading, skip });
  }
  return { lines, newHeadings, phrasesToAdd };
}
