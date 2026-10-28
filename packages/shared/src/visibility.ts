/** Position recorded when the lead's domain is not in the top 100 (spec section 8). */
export const NOT_RANKED_POSITION = 101;

/** What a cell, the CSV and every copy say for NOT_RANKED_POSITION. */
export const NOT_RANKED_LABEL = "Not Ranked";

export type Visibility = "visible" | "partly" | "invisible";

export const VISIBILITY_LABEL: Record<Visibility, string> = {
  visible: "Visible",
  partly: "Partly visible",
  invisible: "Invisible",
};

/** Agreed with the client for Stage 1: 1-20 Visible, 21-100 Partly visible, outside the top 100 Invisible, NULL blank. */
export function visibilityFor(position: number | null): Visibility | null {
  if (position === null) return null;
  if (!Number.isInteger(position) || position < 1) {
    throw new RangeError(`Invalid ranking position: ${position}`);
  }
  if (position <= 20) return "visible";
  if (position <= 100) return "partly";
  return "invisible";
}
