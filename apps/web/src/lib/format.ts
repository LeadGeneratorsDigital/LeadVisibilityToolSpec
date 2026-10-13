const longDateFormat = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

/** British long form without commas, e.g. "Thursday 8 October 2026". ICU versions differ on the comma, so it is built from parts. */
export function formatLongDate(date: Date): string {
  const part = (type: Intl.DateTimeFormatPartTypes) => longDateFormat.formatToParts(date).find((p) => p.type === type)?.value ?? "";
  return `${part("weekday")} ${part("day")} ${part("month")} ${part("year")}`;
}

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** "2026-10-08" or an ISO timestamp -> "8 Oct 2026"; empty -> "". Date-only values are not shifted by timezone. */
export function formatDate(value: string | null): string {
  if (!value) return "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : dateFormat.format(date);
}

/** Ranking cell hover suffix, e.g. " - checked 5 Oct 2026"; blank for rows from before checks were recorded. */
export function checkedSuffix(checkedAt: string | null | undefined): string {
  const date = formatDate(checkedAt ?? null);
  return date ? ` - checked ${date}` : "";
}
