"use client";

/**
 * Everything personal stays in this browser: preferences, schedule, saved
 * start, parked car, recent places and reminder state. Nothing here is sent
 * to CrossMetric except what a request needs (e.g. the start point of a plan).
 * Storage can be unavailable (private mode, blocked site data); the app then
 * works for the current visit only.
 */

import { useCallback, useSyncExternalStore } from "react";
import { DEFAULT_TRAVEL_PREFERENCES, type ClassOccurrence, type ManualClass, type OutboxEntry, type TravelPreferences, type TripTiming } from "@crossmetric/engine/commute";
import type { CampusId, OptionKind, PlanLeg, PlanOption, PlanResponse } from "./commute-types";
import type { JourneyPlace, JourneyResponse } from "./journey-types";

export interface SavedPlace {
  lon: number;
  lat: number;
  label: string;
}

export interface CommutePrefs {
  campus: CampusId | null;
  /** Saved commute start. Never inferred from background location. */
  origin: SavedPlace | null;
  hasCar: boolean;
  permits: string[];
  registered: boolean | null;
  mpg: number | null;
  fuelPrice: number | null;
  walkSpeedMps: number;
  entryBufferMin: number;
  prepMin: number;
  returnBufferMin: number;
  reminders: boolean;
  appearance: "system" | "light" | "dark";
  /** Basemap: "dark" (the brand default: green routes on a near-black map), "light", or "auto" (follows the appearance). */
  mapStyle: "dark" | "light" | "auto";
  modes: OptionKind[];
  /** Save the car's spot automatically when a drive leg ends (off unless chosen). */
  autoSaveCar: boolean;
  /** How the person likes to travel anywhere in Georgia: hard constraints and a priority. */
  travel: TravelPreferences;
  /** Keep recent searches and finished trips on this device (they never leave it). */
  keepHistory: boolean;
  /** The first-visit setup card on Explore was finished or dismissed. */
  setupDone: boolean;
}

export const DEFAULT_PREFS: CommutePrefs = {
  campus: null,
  origin: null,
  hasCar: true,
  permits: [],
  registered: null,
  mpg: null,
  fuelPrice: null,
  walkSpeedMps: 1.25,
  entryBufferMin: 5,
  prepMin: 10,
  returnBufferMin: 15,
  reminders: false,
  appearance: "dark",
  mapStyle: "dark",
  modes: ["walk", "drive", "transit", "park_ride"],
  autoSaveCar: false,
  travel: DEFAULT_TRAVEL_PREFERENCES,
  keepHistory: true,
  setupDone: false,
};

export interface ImportedSeries {
  uid: string;
  title: string;
  location: string;
  buildingId: string | null;
  match: "exact" | "likely" | "ambiguous" | "none" | "remote" | "chosen";
  candidates: string[];
  include: boolean | null;
}

export interface StoredSchedule {
  manual: ManualClass[];
  imported: { campus: CampusId; fileName: string; importedAt: number; series: ImportedSeries[]; occurrences: ClassOccurrence[] } | null;
  /** Per-occurrence choices that survive re-import. */
  overrides: Record<string, { include?: boolean }>;
}

export const EMPTY_SCHEDULE: StoredSchedule = { manual: [], imported: null, overrides: {} };

export interface ParkedCar {
  campus: CampusId;
  placeId: string | null;
  label: string;
  lon: number;
  lat: number;
  savedAt: number;
  /** When the parking eligibility (or chosen stay) ends. */
  until: number | null;
}

export interface Recent {
  campus: CampusId;
  buildingId: string;
  at: number;
}

/** The part of a planned option that step-by-step guidance needs (commute plans and journeys both fit). */
export interface TripOptionLike {
  id: string;
  title: string;
  kind: string;
  legs: PlanLeg[];
  parking: PlanOption["parking"] | null;
  /** Estimated cost when known (transit fare, gas, campus parking); null when unknown. Absent on trips saved by older versions. */
  costUsd?: number | null;
}

export interface ActiveTrip {
  /** Campus whose parking places the legs refer to, when any. */
  campus: CampusId | null;
  option: TripOptionLike;
  /** Campus building destination ("" for other destinations and trips back to the car). */
  buildingId: string;
  destLabel?: string;
  /** The start's label for Activity ("Your location" for the current location; never coordinates). */
  fromLabel?: string;
  leg: number;
  startedAt: number;
  occurrenceKey: string | null;
}

/**
 * A finished trip in Activity: labels and times only. No coordinates or route
 * geometry are kept, so the list never becomes a location history.
 */
export interface PastTrip {
  id: string;
  title: string;
  kind: string;
  from: string | null;
  to: string;
  startedAt: number;
  endedAt: number;
  /** Planned door-to-door minutes (the sum of the legs). */
  plannedMin: number;
  /** True when the person confirmed arriving; false when the trip was ended early. */
  completed: boolean;
  steps: number;
  stepsDone: number;
  /** Estimated cost when it was known; absent on trips saved by older versions. */
  costUsd?: number | null;
}

export interface SavedPlace2 {
  id: string;
  name: string;
  kind: "home" | "work" | "school" | "other";
  place: JourneyPlace;
  savedAt: number;
}

/**
 * A recent search. A start that was "current location" is stored without coordinates,
 * so the list never becomes a location history.
 */
export interface RecentSearch {
  id: string;
  from: JourneyPlace | { current: true };
  to: JourneyPlace;
  /** The time the search asked about; restoring uses Leave now unless the person chooses this again. */
  timing: TripTiming;
  at: number;
}

export interface CachedJourney {
  key: string;
  result: JourneyResponse;
  savedAt: number;
}

export interface CachedPlan {
  key: string;
  plan: PlanResponse;
  savedAt: number;
}

// ---------------------------------------------------------------------------
// Tiny localStorage-backed stores
// ---------------------------------------------------------------------------

type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();
const memory = new Map<string, unknown>();

function read<T>(key: string, fallback: T): T {
  if (memory.has(key)) return memory.get(key) as T;
  let value = fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw) as T;
      // Plain-object settings gain any fields added since they were saved.
      const plain = typeof fallback === "object" && fallback !== null && !Array.isArray(fallback);
      value = plain && parsed && typeof parsed === "object" ? ({ ...fallback, ...parsed } as T) : parsed;
    }
  } catch {
    // Storage unavailable or corrupt: use the fallback for this visit.
  }
  memory.set(key, value);
  return value;
}

function write<T>(key: string, value: T) {
  memory.set(key, value);
  try {
    if (value === null || value === undefined) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Keep the in-memory value; it lasts for this visit.
  }
  listeners.get(key)?.forEach((l) => l());
}

function subscribe(key: string, l: Listener) {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(l);
  const onStorage = (e: StorageEvent) => {
    if (e.key === key) {
      memory.delete(key);
      l();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    set!.delete(l);
    window.removeEventListener("storage", onStorage);
  };
}

export function usePersistent<T>(key: string, fallback: T): [T, (next: T | ((prev: T) => T)) => void] {
  const value = useSyncExternalStore(
    useCallback((l: Listener) => subscribe(key, l), [key]),
    () => read(key, fallback),
    () => fallback,
  );
  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      const prev = read(key, fallback);
      write(key, typeof next === "function" ? (next as (p: T) => T)(prev) : next);
    },
    // fallback is a module constant at every call site
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  return [value, set];
}

export const KEYS = {
  prefs: "cm.prefs.v1",
  schedule: "cm.schedule.v1",
  recents: "cm.recents.v1",
  parked: "cm.parked.v1",
  trip: "cm.trip.v1",
  plan: "cm.plan.v1",
  device: "cm.device.v1",
  outbox: "cm.outbox.v1",
  reports: "cm.myreports.v1",
  feedback: "cm.feedback.v1",
  places: "cm.places.v1",
  searches: "cm.searches.v1",
  journey: "cm.journey.v1",
  splash: "cm.splash.v1",
  history: "cm.history.v1",
  arrive: "cm.arriveby.v1",
} as const;

export const usePrefs = () => usePersistent<CommutePrefs>(KEYS.prefs, DEFAULT_PREFS);
export const useSchedule = () => usePersistent<StoredSchedule>(KEYS.schedule, EMPTY_SCHEDULE);
export const useRecents = () => usePersistent<Recent[]>(KEYS.recents, []);
export const useParkedCar = () => usePersistent<ParkedCar | null>(KEYS.parked, null);
export const useActiveTrip = () => usePersistent<ActiveTrip | null>(KEYS.trip, null);
export const useOutbox = () => usePersistent<OutboxEntry[]>(KEYS.outbox, []);
/** Deletion codes for feedback this browser sent (so it can be withdrawn). */
export const useFeedbackCodes = () => usePersistent<{ code: string; at: number }[]>(KEYS.feedback, []);

export const useSavedPlaces = () => usePersistent<SavedPlace2[]>(KEYS.places, []);
export const useRecentSearches = () => usePersistent<RecentSearch[]>(KEYS.searches, []);
/** Finished trips (newest first, at most 30). */
export const useTripHistory = () => usePersistent<PastTrip[]>(KEYS.history, []);

export function saveJourneyCache(entry: CachedJourney) {
  write(KEYS.journey, entry);
}

export function loadJourneyCache(): CachedJourney | null {
  return read<CachedJourney | null>(KEYS.journey, null);
}

/** Anonymous random key for parking reports (rate limits and undo). Not linked to anything else. */
export function deviceKey(): string {
  let key = read<string | null>(KEYS.device, null);
  if (!key) {
    const bytes = new Uint8Array(18);
    crypto.getRandomValues(bytes);
    key = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    write(KEYS.device, key);
  }
  return key;
}

export function savePlanCache(entry: CachedPlan) {
  write(KEYS.plan, entry);
}

export function loadPlanCache(): CachedPlan | null {
  return read<CachedPlan | null>(KEYS.plan, null);
}

/** Remove everything CrossMetric stored in this browser. */
export function clearAllLocalData() {
  for (const key of Object.values(KEYS)) write(key, null);
}
