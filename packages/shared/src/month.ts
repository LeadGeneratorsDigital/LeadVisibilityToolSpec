const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_KEY = /^(\d{4})-(\d{2})-01$/;

/** Rankings are stored against the first day of the month, as an ISO date string. */
export type MonthKey = string;

function parseMonthKey(month: MonthKey): { year: number; monthIndex: number } {
  const match = MONTH_KEY.exec(month);
  const monthIndex = match ? Number(match[2]) - 1 : -1;
  if (!match || monthIndex < 0 || monthIndex > 11) {
    throw new RangeError(`Invalid month key: ${month}`);
  }
  return { year: Number(match[1]), monthIndex };
}

function toMonthKey(year: number, monthIndex: number): MonthKey {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-01`;
}

/** Month the business is in at `now`. The client is UK-based, so the calendar is Europe/London. */
export function currentMonthKey(now: Date, timeZone = "Europe/London"): MonthKey {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit" }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  return toMonthKey(year, month - 1);
}

/** Spec section 6: three-letter month plus two-digit year, e.g. "Oct 26". */
export function formatMonthHeader(month: MonthKey): string {
  const { year, monthIndex } = parseMonthKey(month);
  return `${MONTH_ABBR[monthIndex]} ${String(year % 100).padStart(2, "0")}`;
}

/** Three-letter month plus four-digit year, e.g. "Oct 2026" - for exports, where "Oct 26" could read as a day. */
export function formatMonthLong(month: MonthKey): string {
  const { year, monthIndex } = parseMonthKey(month);
  return `${MONTH_ABBR[monthIndex]} ${year}`;
}

/** The `count` months ending at `latest`, oldest first. */
export function monthsEndingAt(latest: MonthKey, count: number): MonthKey[] {
  const { year, monthIndex } = parseMonthKey(latest);
  const months: MonthKey[] = [];
  for (let offset = count - 1; offset >= 0; offset--) {
    const total = year * 12 + monthIndex - offset;
    months.push(toMonthKey(Math.floor(total / 12), total % 12));
  }
  return months;
}
