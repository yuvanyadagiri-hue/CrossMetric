/**
 * Words for ArriveBy's data: where a number comes from, how sure it is, and what a
 * parking verdict means. Pure functions, unit-tested, so a label can never say more
 * than the data behind it.
 */
import type { DataStatus, EligibilityStatus, MinuteRange, ParkingAccess, ParkingAssessment, ParkingVerdict, Provenance } from "@crossmetric/engine/commute";

/** The trust level of a piece of information, in a few words. */
export const STATUS_WORD: Record<DataStatus, string> = {
  official: "Official",
  live: "Live",
  estimate: "Estimate",
  community: "Community data",
  user: "From you",
  illustrative: "Example data",
  unknown: "Not available",
};

/** "Oct 12, 2026" for a YYYY-MM-DD date (a calendar date, not an instant). */
export function dayText(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
}

/** "Official · GT Parking visitor parking · checked Oct 12, 2026 · re-check by Nov 12, 2026". */
export function provenanceLine(p: Provenance): string {
  const parts = [STATUS_WORD[p.status], p.label];
  if (p.retrieved) parts.push(`${p.status === "community" ? "data from" : "checked"} ${dayText(p.retrieved)}`);
  if (p.reviewBy) parts.push(`re-check by ${dayText(p.reviewBy)}`);
  return parts.join(" · ");
}

function full(n: number): string {
  const m = Math.max(0, Math.round(n));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} hr ${r} min` : `${h} hr`;
}

/** "16–25 min", "7 min", "43 min–1 hr", "1 hr 5 min–1 hr 20 min". */
export function rangeText(r: MinuteRange): string {
  const lo = Math.round(r.low);
  const hi = Math.round(r.high);
  if (hi <= lo) return full(lo);
  return hi < 60 ? `${lo}–${hi} min` : `${full(lo)}–${full(hi)}`;
}

export const VERDICT_LABEL: Record<ParkingVerdict, string> = {
  recommended: "Recommended",
  backup: "Backup",
  eligible: "Eligible",
  uncertain: "Rules unclear",
  restricted: "Not allowed",
  closed: "Closed",
  full: "Reported full",
  unavailable: "Not available",
};

/** Why you may (or may not) park, in words: "Your permit (W23)", "Pay to park". */
export function accessText(a: ParkingAccess, code: string): string {
  switch (a) {
    case "your_permit":
      return `Your permit (${code})`;
    case "pay":
      return "Pay to park";
    case "free":
      return "No charge at this time";
    case "none":
      return "Not allowed for you";
    case "unknown":
      return "Rules unclear";
  }
}

/** The four statuses the map colours parking by. */
export function arriveParkingStatus(p: Pick<ParkingAssessment, "verdict" | "access">): EligibilityStatus {
  switch (p.verdict) {
    case "recommended":
    case "backup":
    case "eligible":
      return p.access === "pay" ? "requires_action" : "allowed";
    case "restricted":
    case "closed":
    case "full":
      return "prohibited";
    default:
      return "unknown";
  }
}

/** Can the person switch the plan to this place? */
export const usablePlace = (p: Pick<ParkingAssessment, "verdict">) => p.verdict === "recommended" || p.verdict === "backup" || p.verdict === "eligible";
