/**
 * Class schedules: manual recurring classes and normalized calendar occurrences,
 * building matching, and the daily commute target (first in-person class).
 */

import { addDays, CAMPUS_TZ, daysBetween, hhmm, localDate, weekdayOf, zonedToUtc, type Weekday } from "./time";

export interface ManualClass {
  id: string;
  title?: string;
  campus: string;
  buildingId: string;
  days: Weekday[];
  start: string; // HH:MM
  end: string; // HH:MM
  from: string; // YYYY-MM-DD
  until: string; // YYYY-MM-DD
  skip?: string[];
}

export interface ClassOccurrence {
  /** Stable identity: manual|<id>|<date> or ics|<uid>|<recurrence-id or start>. */
  key: string;
  source: "manual" | "ics";
  /** Manual class id or ICS UID. */
  sourceRef: string;
  title?: string;
  start: number;
  end: number;
  date: string;
  buildingId: string | null;
  location?: string;
  status: "confirmed" | "tentative" | "cancelled";
  allDay: boolean;
  remote: boolean;
  /** Explicit user choice; null means "decide from the data". */
  include: boolean | null;
  /** True when the location could not be matched to exactly one building. */
  needsLocation: boolean;
}

export function expandManual(c: ManualClass, fromDate: string, toDate: string, tz: string = CAMPUS_TZ): ClassOccurrence[] {
  const out: ClassOccurrence[] = [];
  const first = fromDate > c.from ? fromDate : c.from;
  const last = toDate < c.until ? toDate : c.until;
  const n = daysBetween(first, last);
  const s = hhmm(c.start);
  const e = hhmm(c.end);
  for (let i = 0; i <= n; i++) {
    const date = addDays(first, i);
    if (!c.days.includes(weekdayOf(date)) || c.skip?.includes(date)) continue;
    out.push({
      key: `manual|${c.id}|${date}`,
      source: "manual",
      sourceRef: c.id,
      title: c.title,
      start: zonedToUtc(date, s, tz),
      end: zonedToUtc(date, e, tz),
      date,
      buildingId: c.buildingId,
      status: "confirmed",
      allDay: false,
      remote: false,
      include: null,
      needsLocation: false,
    });
  }
  return out;
}

/** Whether an occurrence should drive commute planning and reminders. */
export function plannable(o: ClassOccurrence): boolean {
  if (o.status === "cancelled" || o.allDay || !o.buildingId) return false;
  if (o.include === true) return true;
  if (o.include === false) return false;
  return !o.remote && !o.needsLocation && o.status === "confirmed";
}

/** Imported events that duplicate a manual class (same building, same start) are dropped. */
export function dedupeOccurrences(list: ClassOccurrence[]): ClassOccurrence[] {
  const manual = new Set(list.filter((o) => o.source === "manual").map((o) => `${o.buildingId}|${o.start}`));
  const seen = new Set<string>();
  const out: ClassOccurrence[] = [];
  for (const o of list) {
    if (o.source === "ics" && manual.has(`${o.buildingId}|${o.start}`)) continue;
    if (seen.has(o.key)) continue;
    seen.add(o.key);
    out.push(o);
  }
  return out.sort((a, b) => a.start - b.start);
}

export interface DailyTarget {
  date: string;
  first: ClassOccurrence;
  /** Other plannable classes that overlap the first one (flagged, never silently resolved). */
  overlaps: ClassOccurrence[];
  later: ClassOccurrence[];
}

export function dailyTargets(list: ClassOccurrence[], tz: string = CAMPUS_TZ): DailyTarget[] {
  const byDate = new Map<string, ClassOccurrence[]>();
  for (const o of list) {
    if (!plannable(o)) continue;
    const d = localDate(o.start, tz);
    const arr = byDate.get(d) ?? [];
    arr.push(o);
    byDate.set(d, arr);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, arr]) => {
      arr.sort((a, b) => a.start - b.start || a.key.localeCompare(b.key));
      const first = arr[0]!;
      const overlaps = arr.slice(1).filter((o) => o.start < first.end);
      const later = arr.slice(1).filter((o) => o.start >= first.end);
      return { date, first, overlaps, later };
    });
}

/** Next class at or after `now` that still needs a commute (start not yet passed). */
export function nextClass(list: ClassOccurrence[], now: number): ClassOccurrence | null {
  return list.filter((o) => plannable(o) && o.start > now).sort((a, b) => a.start - b.start)[0] ?? null;
}

// ---------------------------------------------------------------------------
// Building matching
// ---------------------------------------------------------------------------

export interface BuildingRef {
  id: string;
  name: string;
  aliases: string[];
  ref?: string | null;
}

export interface BuildingMatch {
  status: "exact" | "likely" | "ambiguous" | "none";
  matches: BuildingRef[];
}

const REMOTE = /\b(online|zoom|teams|remote|virtual|asynchronous|async|web[- ]?based|distance learning)\b/i;
const STOP = new Set(["room", "rm", "bldg", "building", "the", "of", "and", "at", "lecture", "lab", "suite", "floor", "fl", "hall", "center", "centre"]);

export function isRemoteLocation(text: string | undefined | null): boolean {
  return !!text && REMOTE.test(text);
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function words(s: string): string[] {
  return norm(s)
    .split(" ")
    .filter((w) => w && !/\d/.test(w) && !STOP.has(w));
}

/**
 * Match free-text class locations ("Klaus 1443", "Clough Undergraduate Learning Commons 144")
 * to one campus building. Ambiguous text returns every candidate so the person can choose.
 */
export function resolveBuilding(text: string, buildings: BuildingRef[]): BuildingMatch {
  const t = norm(text);
  if (!t) return { status: "none", matches: [] };
  const names = (b: BuildingRef) => [b.name, ...b.aliases];
  const exact = buildings.filter((b) => names(b).some((n) => norm(n) === t));
  if (exact.length === 1) return { status: "exact", matches: exact };
  if (exact.length > 1) return { status: "ambiguous", matches: exact };

  const q = words(text);
  if (!q.length) return { status: "none", matches: [] };
  let bestScore = 0;
  let best: BuildingRef[] = [];
  for (const b of buildings) {
    let score = 0;
    for (const n of names(b)) {
      const nw = words(n);
      if (!nw.length) continue;
      const covered = q.filter((w) => nw.some((x) => x === w || (w.length >= 4 && x.startsWith(w)))).length;
      if (covered === 0) continue;
      // Every query word found, weighted by how much of the building name it covers.
      const s = covered === q.length ? 2 + covered / nw.length + (nw[0] === q[0] ? 0.5 : 0) : covered / (q.length + nw.length);
      score = Math.max(score, s);
    }
    if (score > bestScore + 1e-9) {
      bestScore = score;
      best = [b];
    } else if (score > 0 && Math.abs(score - bestScore) < 1e-9) best.push(b);
  }
  if (bestScore < 2) return { status: best.length ? "ambiguous" : "none", matches: best.slice(0, 5) };
  return best.length === 1 ? { status: "likely", matches: best } : { status: "ambiguous", matches: best.slice(0, 5) };
}
