/**
 * Trip timing: the three explicit modes a person can choose.
 *
 *   now     leave as soon as possible (the default for every new search)
 *   depart  leave at a chosen date and time
 *   arrive  arrive by a chosen date and time (planned backwards)
 *
 * A time is only ever what the person picked: nothing here rolls a time that has
 * passed over to tomorrow, and no schedule, parking time or earlier search
 * supplies one. Times are wall-clock times in Georgia (America/New_York),
 * whatever time zone the device is in.
 */

import { CAMPUS_TZ, addDays, clockLabel, localDate, localMinutes, zonedToUtc } from "./time";

export type TripTiming = { mode: "now" } | { mode: "depart"; at: number } | { mode: "arrive"; by: number };

export const LEAVE_NOW: TripTiming = Object.freeze({ mode: "now" }) as TripTiming;

/** A chosen time may be this far in the past (the person was still filling in the form). */
export const PAST_GRACE_MS = 5 * 60_000;
/** Furthest ahead a journey may be planned. Timetables usually end sooner; that is reported separately. */
export const MAX_AHEAD_MS = 365 * 86_400_000;

export type TimingProblem = "past" | "too_far" | "invalid";

export type TimingCheck = { ok: true; timing: TripTiming } | { ok: false; problem: TimingProblem; message: string };

/** The instant a timing refers to: the departure for now/depart, the deadline for arrive. */
export function timingInstant(t: TripTiming, now: number): number {
  return t.mode === "now" ? now : t.mode === "depart" ? t.at : t.by;
}

/** Validate a timing against the current time. Past times are rejected, never moved. */
export function checkTiming(t: TripTiming | null | undefined, now: number): TimingCheck {
  if (!t || typeof t !== "object") return { ok: false, problem: "invalid", message: "Choose when you want to travel." };
  if (t.mode === "now") return { ok: true, timing: LEAVE_NOW };
  const at = t.mode === "depart" ? t.at : t.mode === "arrive" ? t.by : NaN;
  if (typeof at !== "number" || !Number.isFinite(at)) return { ok: false, problem: "invalid", message: "Choose a valid date and time." };
  if (at < now - PAST_GRACE_MS) {
    return { ok: false, problem: "past", message: t.mode === "depart" ? "That departure time has passed. Choose a later time or Leave now." : "That arrival time has passed. Choose a later time or Leave now." };
  }
  if (at > now + MAX_AHEAD_MS) return { ok: false, problem: "too_far", message: "Choose a time within the next year." };
  return { ok: true, timing: t.mode === "depart" ? { mode: "depart", at } : { mode: "arrive", by: at } };
}

/** How a requested wall-clock time maps onto real instants around a DST change. */
export type LocalTimeStatus = "exact" | "skipped" | "ambiguous";

/**
 * A local date ("YYYY-MM-DD") and time ("HH:MM") in `tz` as an instant.
 * - "skipped": the time does not exist (spring forward); the instant is the same
 *   number of minutes after midnight on the shifted clock (2:30 AM becomes 3:30 AM).
 * - "ambiguous": the time happens twice (fall back); the first occurrence is used.
 */
export function localInputsToInstant(date: string, time: string, tz: string = CAMPUS_TZ): { at: number; status: LocalTimeStatus } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  const minutes = h * 60 + min;
  const at = zonedToUtc(date, minutes, tz);
  if (localDate(at, tz) !== date || Math.floor(localMinutes(at, tz)) !== minutes) return { at, status: "skipped" };
  const later = at + 3_600_000;
  const ambiguous = localDate(later, tz) === date && Math.floor(localMinutes(later, tz)) === minutes;
  return { at, status: ambiguous ? "ambiguous" : "exact" };
}

/** An instant as form values: local date and "HH:MM" in `tz`. */
export function instantToLocalInputs(ms: number, tz: string = CAMPUS_TZ): { date: string; time: string } {
  const mins = Math.floor(localMinutes(ms, tz));
  return { date: localDate(ms, tz), time: `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}` };
}

/** A sensible starting value when someone switches to "Depart at" or "Arrive by": the next 5-minute mark at least 15 minutes ahead. Never in the past. */
export function suggestedTime(now: number, leadMin = 15): number {
  const step = 5 * 60_000;
  return Math.ceil((now + leadMin * 60_000) / step) * step;
}

/** "Today", "Tomorrow" or "Tue, Oct 14" in `tz`, relative to `now`. */
export function dayWord(ms: number, now: number, tz: string = CAMPUS_TZ): string {
  const d = localDate(ms, tz);
  const today = localDate(now, tz);
  if (d === today) return "Today";
  if (d === addDays(today, 1)) return "Tomorrow";
  if (d === addDays(today, -1)) return "Yesterday";
  return new Date(ms).toLocaleDateString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" });
}

/** "Leave now", "Depart today 5:20 PM", "Arrive by Tomorrow 9:00 AM". */
export function timingLabel(t: TripTiming, now: number, tz: string = CAMPUS_TZ): string {
  if (t.mode === "now") return "Leave now";
  const at = t.mode === "depart" ? t.at : t.by;
  const day = dayWord(at, now, tz);
  const when = `${day === "Today" ? "today" : day} ${clockLabel(at, tz)}`;
  return t.mode === "depart" ? `Depart ${when}` : `Arrive by ${when}`;
}

/** Stable key for a timing (minute resolution). Two searches with the same key asked the same question about time. */
export function timingKey(t: TripTiming): string {
  if (t.mode === "now") return "now";
  const at = t.mode === "depart" ? t.at : t.by;
  return `${t.mode}:${Math.round(at / 60_000)}`;
}

/** How long a leave-now result still describes "now". */
export const LEAVE_NOW_FRESH_MS = 5 * 60_000;
export const LEAVE_NOW_STALE_MS = 15 * 60_000;

export type Freshness = "fresh" | "aging" | "stale" | "past";

/**
 * Whether a result computed at `generatedAt` still answers the question on screen.
 * - leave now: fresh for 5 minutes, then aging (shown with its age), stale after 15
 * - depart/arrive: "past" once the chosen time has gone by (a new time is needed)
 */
export function resultFreshness(t: TripTiming, generatedAt: number, now: number): Freshness {
  if (t.mode !== "now") return timingInstant(t, now) < now - PAST_GRACE_MS ? "past" : now - generatedAt > 6 * 3_600_000 ? "aging" : "fresh";
  const age = now - generatedAt;
  if (age > LEAVE_NOW_STALE_MS) return "stale";
  if (age > LEAVE_NOW_FRESH_MS) return "aging";
  return "fresh";
}
