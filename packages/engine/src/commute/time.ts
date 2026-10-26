/**
 * Wall-clock time in a campus time zone, DST-safe, using only Intl.
 *
 * Instants are UTC epoch milliseconds. Local dates are "YYYY-MM-DD" strings
 * and local times are minutes after local midnight (0-1440).
 */

export const CAMPUS_TZ = "America/New_York";

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(tz, f);
  }
  return f;
}

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function partsAt(ms: number, tz: string): Parts {
  const out: Record<string, number> = {};
  for (const p of formatter(tz).formatToParts(new Date(ms))) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return { year: out.year!, month: out.month!, day: out.day!, hour: out.hour! % 24, minute: out.minute!, second: out.second! };
}

/** Offset of `tz` from UTC at an instant, in minutes (e.g. -240 for EDT). */
export function tzOffsetMinutes(ms: number, tz: string = CAMPUS_TZ): number {
  const p = partsAt(ms, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000);
}

export function parseDate(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split("-").map(Number);
  return { y: y!, m: m!, d: d! };
}

export function formatDateParts(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function addDays(date: string, n: number): string {
  const { y, m, d } = parseDate(date);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return formatDateParts(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function weekdayOf(date: string): Weekday {
  const { y, m, d } = parseDate(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() as Weekday;
}

export function daysBetween(a: string, b: string): number {
  const pa = parseDate(a);
  const pb = parseDate(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86_400_000);
}

/**
 * The instant at which the wall clock in `tz` reads `minutes` after midnight on `date`.
 * In the spring-forward gap the result is the instant one hour later on the wall clock;
 * in the fall-back overlap it is the first (daylight-time) occurrence.
 */
export function zonedToUtc(date: string, minutes: number, tz: string = CAMPUS_TZ): number {
  const { y, m, d } = parseDate(date);
  const naive = Date.UTC(y, m - 1, d, 0, 0, 0) + Math.round(minutes * 60_000);
  let guess = naive - tzOffsetMinutes(naive, tz) * 60_000;
  // Two refinements settle every DST edge.
  for (let i = 0; i < 2; i++) {
    const next = naive - tzOffsetMinutes(guess, tz) * 60_000;
    if (next === guess) break;
    guess = next;
  }
  // Fall-back overlap: prefer the earlier instant if it reads the same wall time.
  const earlier = guess - 3_600_000;
  if (localMinutes(earlier, tz) === localMinutes(guess, tz) && localDate(earlier, tz) === localDate(guess, tz)) return earlier;
  return guess;
}

export function localDate(ms: number, tz: string = CAMPUS_TZ): string {
  const p = partsAt(ms, tz);
  return formatDateParts(p.year, p.month, p.day);
}

export function localMinutes(ms: number, tz: string = CAMPUS_TZ): number {
  const p = partsAt(ms, tz);
  return p.hour * 60 + p.minute + p.second / 60;
}

export function localWeekday(ms: number, tz: string = CAMPUS_TZ): Weekday {
  return weekdayOf(localDate(ms, tz));
}

/** "HH:MM" (00:00-24:00) to minutes after midnight. */
export function hhmm(value: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) throw new Error(`Invalid time "${value}"`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) throw new Error(`Invalid time "${value}"`);
  return h * 60 + min;
}

/** GTFS service-day reference: "noon minus 12 hours" in local time, as an instant. */
export function serviceDayStart(date: string, tz: string = CAMPUS_TZ): number {
  return zonedToUtc(date, 12 * 60, tz) - 12 * 3_600_000;
}

/** "9:05 AM" style clock label in the campus zone. */
export function clockLabel(ms: number, tz: string = CAMPUS_TZ): string {
  const mins = Math.floor(localMinutes(ms, tz));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
