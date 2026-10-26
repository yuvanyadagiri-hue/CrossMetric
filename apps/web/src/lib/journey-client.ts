/**
 * Journey rules the app follows, as pure functions (tested in test/journey.unit.test.ts):
 * which preferences a search uses, when results still describe the inputs on screen,
 * and how recent searches are stored and restored without becoming a location history.
 */
import {
  checkTiming,
  DEFAULT_TRAVEL_PREFERENCES,
  JOURNEY_MODES,
  LEAVE_NOW,
  localMinutes,
  resultFreshness,
  type Freshness,
  type JourneyMode,
  type Priority,
  type TravelPreferences,
  type TripTiming,
} from "@crossmetric/engine/commute";
import type { RecentSearch } from "./commute-store";
import type { JourneyPlace } from "./journey-types";

/** Fill in anything missing from preferences saved by an older version. */
export function normalizeTravel(t: Partial<TravelPreferences> | null | undefined): TravelPreferences {
  const d = DEFAULT_TRAVEL_PREFERENCES;
  if (!t) return { ...d, modes: { ...d.modes }, prefer: [] };
  return {
    modes: Object.fromEntries(JOURNEY_MODES.map((m) => [m, typeof t.modes?.[m] === "boolean" ? t.modes[m] : d.modes[m]])) as Record<JourneyMode, boolean>,
    maxWalkMin: t.maxWalkMin ?? null,
    maxTransfers: t.maxTransfers ?? null,
    accessible: !!t.accessible,
    priority: t.priority ?? d.priority,
    prefer: Array.isArray(t.prefer) ? t.prefer.filter((m) => JOURNEY_MODES.includes(m)) : [],
  };
}

/** What a typed request asked for, applied to this search only (shown as removable chips). */
export interface SearchOverrides {
  modesOff: JourneyMode[];
  modesOn: JourneyMode[];
  prefer: JourneyMode[];
  priority: Priority | null;
  maxTransfers: number | null;
  accessible: boolean;
  understood: string[];
}

export function effectivePrefs(travel: TravelPreferences, hasCar: boolean, o: SearchOverrides | null): TravelPreferences {
  const p = normalizeTravel(travel);
  const modes = { ...p.modes };
  if (o) {
    for (const m of o.modesOn) modes[m] = true;
    for (const m of o.modesOff) modes[m] = false;
  }
  // Without a car, driving yourself is not an option (ride-hail is offered separately).
  if (!hasCar) {
    modes.drive = false;
    modes.park_ride = false;
  }
  return {
    modes,
    maxWalkMin: p.maxWalkMin,
    maxTransfers: o?.maxTransfers ?? p.maxTransfers,
    accessible: p.accessible || !!o?.accessible,
    priority: o?.priority ?? p.priority,
    prefer: o?.prefer.length ? o.prefer : p.prefer,
  };
}

export type JourneyPhase =
  | "needs_origin"
  | "needs_destination"
  | "loading"
  /** Inputs changed; the shown results are for the previous inputs and a new search is running. */
  | "updating"
  | "ready"
  /** Leave-now results a few minutes old: shown with their age. */
  | "aging"
  /** Results no longer describe the question (old leave-now, or a chosen time that has passed). */
  | "stale"
  | "error"
  | "offline";

export interface PhaseInput {
  hasOrigin: boolean;
  hasDestination: boolean;
  inputKey: string | null;
  resultKey: string | null;
  generatedAt: number | null;
  loading: boolean;
  error: boolean;
  online: boolean;
  timing: TripTiming;
  now: number;
}

/**
 * One state for the results area. Results are "current" only when they were computed
 * for exactly the inputs on screen and are still fresh for the chosen timing.
 */
export function journeyPhase(i: PhaseInput): JourneyPhase {
  if (!i.hasDestination) return "needs_destination";
  if (!i.hasOrigin) return "needs_origin";
  const matches = i.resultKey !== null && i.resultKey === i.inputKey;
  if (i.loading) return i.resultKey !== null ? "updating" : "loading";
  if (!matches) return !i.online ? "offline" : i.error ? "error" : i.resultKey !== null ? "updating" : "loading";
  const f: Freshness = resultFreshness(i.timing, i.generatedAt ?? 0, i.now);
  if (f === "stale" || f === "past") return "stale";
  if (f === "aging") return "aging";
  return "ready";
}

/** Results that may be acted on (selected, started, saved). */
export function actionable(phase: JourneyPhase): boolean {
  return phase === "ready" || phase === "aging";
}

const r5 = (v: number) => Math.round(v * 1e5) / 1e5;
const placeId = (p: JourneyPlace | { current: true }) => ("current" in p ? "current" : p.buildingId ? `b:${p.campus}:${p.buildingId}` : `${r5(p.lon)},${r5(p.lat)}`);

/** A recent-search entry. A current-location start keeps no coordinates. */
export function recentFrom(origin: JourneyPlace, destination: JourneyPlace, timing: TripTiming, at: number): RecentSearch {
  const from: RecentSearch["from"] = origin.source === "current" ? { current: true } : origin;
  return { id: `${placeId(from)}>${placeId(destination)}`, from, to: destination.source === "current" ? { ...destination, label: "Your location then" } : destination, timing, at };
}

export function pushRecent(list: RecentSearch[], entry: RecentSearch, max = 12): RecentSearch[] {
  return [entry, ...list.filter((r) => r.id !== entry.id)].slice(0, max);
}

/**
 * Restoring a recent search brings back the places, never the time: it plans for
 * Leave now, and offers the original time only while it is still in the future.
 */
export function restoreRecent(r: RecentSearch, now: number): { origin: JourneyPlace | null; needsLocation: boolean; destination: JourneyPlace; timing: TripTiming; originalTiming: TripTiming | null } {
  const original = r.timing.mode !== "now" && checkTiming(r.timing, now).ok ? r.timing : null;
  return { origin: "current" in r.from ? null : r.from, needsLocation: "current" in r.from, destination: r.to, timing: LEAVE_NOW, originalTiming: original };
}

/** Pairs searched at least twice, most frequent first. */
export function frequentRoutes(list: RecentSearch[], min = 2): { id: string; count: number; search: RecentSearch }[] {
  const counts = new Map<string, { count: number; search: RecentSearch }>();
  for (const r of list) {
    const c = counts.get(r.id);
    if (c) c.count++;
    else counts.set(r.id, { count: 1, search: r });
  }
  return [...counts.entries()].filter(([, v]) => v.count >= min).map(([id, v]) => ({ id, ...v })).sort((a, b) => b.count - a.count);
}

/** "Good morning" / "Good afternoon" / "Good evening" in Georgia time. */
export function greeting(now: number): string {
  const m = localMinutes(now);
  if (m < 4 * 60 || m >= 18 * 60) return "Good evening";
  if (m < 12 * 60) return "Good morning";
  return "Good afternoon";
}

export const PRIORITY_LABEL: Record<Priority, string> = {
  balanced: "Balanced",
  fastest: "Fastest",
  cheapest: "Cheapest",
  least_walking: "Least walking",
  fewest_transfers: "Fewest transfers",
  safety: "Fewer risk indicators",
};
