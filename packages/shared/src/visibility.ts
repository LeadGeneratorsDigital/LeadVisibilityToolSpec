/** Position recorded when the lead's domain is not in the top 100 (spec section 8). */
export const NOT_RANKED_POSITION = 101;

export type Visibility = "visible" | "partly" | "invisible";

export const VISIBILITY_LABEL: Record<Visibility, string> = {
  visible: "Visible",
  partly: "Partly visible",
  invisible: "Invisible",
};

/** Spec section 6: 1-20 Visible, 21-50 Partly visible, 51+ / not ranked Invisible, NULL blank. */
export function visibilityFor(position: number | null): Visibility | null {
  if (position === null) return null;
  if (!Number.isInteger(position) || position < 1) {
    throw new RangeError(`Invalid ranking position: ${position}`);
  }
  if (position <= 20) return "visible";
  if (position <= 50) return "partly";
  return "invisible";
}
