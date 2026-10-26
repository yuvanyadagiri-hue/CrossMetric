"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { checkTiming, LEAVE_NOW, type TravelPreferences, type TripTiming } from "@crossmetric/engine/commute";
import { loadJourneyCache, saveJourneyCache, useRecentSearches, type RecentSearch } from "@/lib/commute-store";
import { actionable, effectivePrefs, journeyPhase, pushRecent, recentFrom, restoreRecent, type JourneyPhase, type SearchOverrides } from "@/lib/journey-client";
import type { JourneyApiError, JourneyOption, JourneyPlace, JourneyRequest, JourneyResponse, JourneyVehicle } from "@/lib/journey-types";
import { journeyKey } from "@/lib/journey-types";

interface Options {
  travel: TravelPreferences;
  vehicle: JourneyVehicle;
  fuelPrice: number | null;
  walkSpeedMps: number;
  online: boolean;
  now: number;
  keepHistory: boolean;
}

interface Fetched {
  key: string | null;
  result: JourneyResponse | null;
  error: (JourneyApiError & { offline?: boolean }) | null;
  loading: boolean;
  /** Shown from this device's cache because the network failed. */
  cachedAt: number | null;
}

const EMPTY: Fetched = { key: null, result: null, error: null, loading: false, cachedAt: null };
const DEBOUNCE_MS = 350;

/**
 * The trip being planned: start, destination, timing and the results for exactly
 * those inputs. A new search always starts as Leave now. Results carry the key of
 * the inputs they were computed for, so edited inputs never show old results as
 * current, and a late response for old inputs is discarded.
 */
export function useJourney(o: Options) {
  const [origin, setOriginState] = useState<JourneyPlace | null>(null);
  const [destination, setDestinationState] = useState<JourneyPlace | null>(null);
  const [timing, setTimingState] = useState<TripTiming>(LEAVE_NOW);
  const [overrides, setOverrides] = useState<SearchOverrides | null>(null);
  /** Once the person has asked for routes, edits re-run the search automatically. */
  const [auto, setAuto] = useState(false);
  const [fetched, setFetched] = useState<Fetched>(EMPTY);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** A restored search's original time, offered (never applied) while it is still ahead. */
  const [offerTiming, setOfferTiming] = useState<TripTiming | null>(null);
  const [, setRecents] = useRecentSearches();

  const timingCheck = useMemo(() => checkTiming(timing, o.now), [timing, o.now]);
  const prefs = useMemo(() => effectivePrefs(o.travel, o.vehicle.hasCar, overrides), [o.travel, o.vehicle.hasCar, overrides]);
  const request: JourneyRequest | null = useMemo(() => {
    if (!origin || !destination || !timingCheck.ok) return null;
    return { origin, destination, timing: timingCheck.timing, prefs, vehicle: o.vehicle, fuelPrice: o.fuelPrice, walkSpeedMps: o.walkSpeedMps };
  }, [origin, destination, timingCheck, prefs, o.vehicle, o.fuelPrice, o.walkSpeedMps]);
  const inputKey = request ? journeyKey(request) : null;

  const ctrl = useRef<AbortController | null>(null);
  const latest = useRef<{ key: string | null; request: JourneyRequest | null; keepHistory: boolean }>({ key: null, request: null, keepHistory: o.keepHistory });
  useEffect(() => {
    latest.current = { key: inputKey, request, keepHistory: o.keepHistory };
  });

  const run = useCallback(() => {
    const { key, request: req } = latest.current;
    if (!key || !req) return;
    setAuto(true);
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setFetched((s) => ({ ...s, loading: true, error: null }));
    (async () => {
      let res: Response;
      try {
        res = await fetch("/api/journey/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req), signal: c.signal });
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        // Network failure: offline, or the server cannot be reached.
        const cached = loadJourneyCache();
        if (latest.current.key !== key) return;
        if (cached && cached.key === key) setFetched({ key, result: cached.result, error: { error: "You're offline. Showing the last result saved on this device.", kind: "unavailable", offline: true }, loading: false, cachedAt: cached.savedAt });
        else setFetched((s) => ({ ...s, loading: false, error: { error: navigator.onLine ? "CrossMetric can't be reached right now." : "You're offline.", kind: "unavailable", offline: !navigator.onLine } }));
        return;
      }
      const body = (await res.json().catch(() => null)) as (JourneyResponse & Partial<JourneyApiError>) | null;
      // A response for inputs that have since changed is dropped.
      if (c.signal.aborted || latest.current.key !== key) return;
      if (!res.ok || !body || body.error) {
        setFetched((s) => ({ ...s, loading: false, error: { error: body?.error ?? "Routes couldn't be calculated right now.", kind: body?.kind ?? "unavailable", field: body?.field } }));
        return;
      }
      setFetched({ key, result: body, error: null, loading: false, cachedAt: null });
      setSelectedId(null);
      saveJourneyCache({ key, result: body, savedAt: Date.now() });
      if (latest.current.keepHistory) setRecents((list) => pushRecent(list, recentFrom(req.origin, req.destination, req.timing, Date.now())));
    })();
  }, [setRecents]);

  // Re-run automatically after edits, once the person has asked for routes.
  useEffect(() => {
    if (!auto || !inputKey || inputKey === fetched.key) return;
    const t = setTimeout(run, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [auto, inputKey, fetched.key, run]);

  const phase: JourneyPhase = journeyPhase({
    hasOrigin: !!origin,
    hasDestination: !!destination,
    inputKey,
    resultKey: fetched.key,
    generatedAt: fetched.result?.generatedAt ?? null,
    loading: fetched.loading,
    error: !!fetched.error && !fetched.cachedAt,
    online: o.online,
    timing,
    now: o.now,
  });

  // Leave-now results go stale after a while: refresh them while the page is visible and online.
  const lastAuto = useRef(0);
  useEffect(() => {
    if (phase !== "stale" || timing.mode !== "now" || !o.online || document.visibilityState !== "visible") return;
    if (Date.now() - lastAuto.current < 60_000) return;
    lastAuto.current = Date.now();
    run();
  }, [phase, timing.mode, o.online, o.now, run]);

  const result = fetched.result;
  const options = useMemo(() => result?.options ?? [], [result]);
  const selected: JourneyOption | null = options.find((x) => x.id === selectedId) ?? options[0] ?? null;

  const setOrigin = useCallback((p: JourneyPlace | null) => setOriginState(p), []);
  const setDestination = useCallback((p: JourneyPlace | null) => setDestinationState(p), []);
  const setTiming = useCallback((t: TripTiming) => {
    setTimingState(t);
    setOfferTiming(null);
  }, []);

  /** A new search: a new destination, Leave now, and only the overrides the typed request asked for. */
  const startSearch = useCallback((dest: JourneyPlace, extra: { origin?: JourneyPlace | null; overrides?: SearchOverrides | null; timing?: TripTiming } = {}) => {
    setDestinationState(dest);
    if (extra.origin !== undefined) setOriginState(extra.origin);
    setTimingState(extra.timing ?? LEAVE_NOW);
    setOverrides(extra.overrides ?? null);
    setOfferTiming(null);
    setSelectedId(null);
    setAuto(true);
  }, []);

  const restore = useCallback(
    (r: RecentSearch, now: number) => {
      const x = restoreRecent(r, now);
      setDestinationState(x.destination);
      if (x.origin) setOriginState(x.origin);
      setTimingState(x.timing);
      setOverrides(null);
      setOfferTiming(x.originalTiming);
      setSelectedId(null);
      setAuto(true);
      return x;
    },
    [],
  );

  const swap = useCallback(() => {
    setOriginState(destination);
    setDestinationState(origin);
  }, [origin, destination]);

  const clear = useCallback(() => {
    ctrl.current?.abort();
    setDestinationState(null);
    setTimingState(LEAVE_NOW);
    setOverrides(null);
    setOfferTiming(null);
    setFetched(EMPTY);
    setSelectedId(null);
    setAuto(false);
  }, []);

  useEffect(() => () => ctrl.current?.abort(), []);

  return {
    origin,
    destination,
    timing,
    timingError: timingCheck.ok ? null : timingCheck.message,
    overrides,
    prefs,
    request,
    inputKey,
    phase,
    actionable: actionable(phase),
    result,
    resultKey: fetched.key,
    error: fetched.error,
    cachedAt: fetched.cachedAt,
    loading: fetched.loading,
    options,
    selected,
    offerTiming,
    setOrigin,
    setDestination,
    setTiming,
    setOverrides,
    select: setSelectedId,
    startSearch,
    restore,
    swap,
    clear,
    run,
  };
}

export type Journey = ReturnType<typeof useJourney>;
