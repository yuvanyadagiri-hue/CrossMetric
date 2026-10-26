/**
 * Formatting that never shows NaN, Infinity, undefined or null to a person.
 * "Unavailable" and 0 are deliberately different outputs.
 */

const UNAVAILABLE = "Unavailable";

export function formatInt(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return UNAVAILABLE;
  return Math.round(value).toLocaleString("en-US");
}

export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${formatInt(n)} ${n === 1 ? singular : pluralForm}`;
}

export const METERS_PER_MILE = 1609.344;

export function formatMiles(meters: number | null | undefined): string {
  if (meters === null || meters === undefined || !Number.isFinite(meters)) return UNAVAILABLE;
  const miles = meters / METERS_PER_MILE;
  return `${miles < 0.995 ? miles.toFixed(2) : miles.toFixed(1)} mi`;
}

export function formatMeters(meters: number | null | undefined): string {
  if (meters === null || meters === undefined || !Number.isFinite(meters)) return UNAVAILABLE;
  return `${formatInt(meters)} m`;
}

export function formatRadius(meters: number): string {
  return `${formatInt(meters)} m`;
}

export function formatAadt(aadt: number | null | undefined): string {
  if (aadt === null || aadt === undefined || !Number.isFinite(aadt)) return UNAVAILABLE;
  return `${formatInt(aadt)} vehicles/day`;
}

export function formatScore(score: number | null | undefined): string {
  if (score === null || score === undefined || !Number.isFinite(score)) return "—";
  return String(Math.floor(score + 0.5));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDate(iso: string | null | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return UNAVAILABLE;
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** Calendar date of an ISO timestamp in Georgia (Eastern) time, e.g. "Oct 3, 2026". */
export function formatTimestampDate(iso: string | null | undefined): string {
  if (!iso) return UNAVAILABLE;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return UNAVAILABLE;
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric" }).format(t);
}

export function periodPhrase(periodYears: 1 | 3): string {
  return periodYears === 1 ? "most recent 12 months" : "full data window";
}

export const FUNCTIONAL_CLASS_LABELS: Record<number, string> = {
  1: "Interstate",
  2: "Freeway or expressway",
  3: "Principal arterial",
  4: "Minor arterial",
  5: "Major collector",
  6: "Minor collector",
  7: "Local road",
};

export function functionalClassLabel(code: number): string {
  return FUNCTIONAL_CLASS_LABELS[code] ?? UNAVAILABLE;
}
