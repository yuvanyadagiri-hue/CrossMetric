"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildArrivalPlan, checkTiming, suggestedTime, type ArrivalPlan, type ArrivePreference, type TravelPreferences } from "@crossmetric/engine/commute";
import type { ArriveByResponse } from "@/lib/arriveby-types";
import { KEYS, usePersistent } from "@/lib/commute-store";
import type { JourneyApiError, JourneyOption, JourneyPlace, JourneyVehicle } from "@/lib/journey-types";

interface Options {
  origin: JourneyPlace | null;
  travel: TravelPreferences;
  vehicle: JourneyVehicle;
  fuelPrice: number | null;
  walkSpeedMps: number;
  online: boolean;
  now: number;
}

/** Remembered on this device: the last destination and the preferred way. Never a time (a remembered time would silently become "tomorrow"). */
interface Stored {
  destination: JourneyPlace | null;
  prefer: ArrivePreference;
}
const STORED_DEFAULT: Stored = { destination: null, prefer: "best" };

interface Fetched {
  key: string | null;
  result: ArriveByResponse | null;
  error: (JourneyApiError & { offline?: boolean }) | null;
  loading: boolean;
}
const EMPTY: Fetched = { key: null, result: null, error: null, loading: false };
const DEBOUNCE_MS = 450;
/** A plan this old is shown as out of date (times may have moved: traffic buffers, the next bus). */
export const ARRIVE_STALE_MS = 10 * 60_000;

export type ArrivePhase = "needs_destination" | "needs_origin" | "needs_time" | "loading" | "updating" | "error" | "offline" | "ready" | "stale" | "passed";

/**
 * ArriveBy's inputs and its plan. The server routes and checks parking once per set of
 * inputs; the choices that do not change routing (Best / Drive / Transit…, which lot)
 * re-run the same engine function on the returned basis, so they are instant and never
 * show a plan for other inputs. A late response for older inputs is discarded.
 */
export function useArriveBy(o: Options) {
  const [stored, setStored] = usePersistent<Stored>(KEYS.arrive, STORED_DEFAULT);
  const destination = stored.destination;
  const prefer = stored.prefer;
  const [arriveBy, setArriveByState] = useState<number>(() => suggestedTime(Date.now(), 60));
  const [parkUntil, setParkUntil] = useState<number | null>(null);
  const [preferredPlaceId, setPreferredPlaceId] = useState<string | null>(null);
  const [fetched, setFetched] = useState<Fetched>(EMPTY);
  /** The inputs stay open while the person is choosing (across the search page), until Done. */
  const [formOpen, setFormOpen] = useState(true);

  const timing = useMemo(() => checkTiming({ mode: "arrive", by: arriveBy }, o.now), [arriveBy, o.now]);
  const body = useMemo(() => {
    if (!o.origin || !destination || !timing.ok) return null;
    return { origin: o.origin, destination, arriveBy, parkUntil: parkUntil && parkUntil > arriveBy ? parkUntil : null, prefer: "best" as const, prefs: o.travel, vehicle: o.vehicle, fuelPrice: o.fuelPrice, walkSpeedMps: o.walkSpeedMps };
  }, [o.origin, destination, timing.ok, arriveBy, parkUntil, o.travel, o.vehicle, o.fuelPrice, o.walkSpeedMps]);
  // Everything that changes routing or parking rules, at minute resolution.
  const key = useMemo(() => (body ? JSON.stringify({ ...body, arriveBy: Math.round(body.arriveBy / 60_000), parkUntil: body.parkUntil ? Math.round(body.parkUntil / 60_000) : null }) : null), [body]);

  const ctrl = useRef<AbortController | null>(null);
  const latest = useRef<{ key: string | null; body: typeof body }>({ key: null, body: null });
  useEffect(() => {
    latest.current = { key, body };
  });

  const run = useCallback(() => {
    const { key: k, body: b } = latest.current;
    if (!k || !b) return;
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setFetched((s) => ({ ...s, loading: true, error: null }));
    (async () => {
      let res: Response;
      try {
        res = await fetch("/api/arriveby/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b), signal: c.signal });
      } catch (err) {
        if ((err as Error).name === "AbortError" || latest.current.key !== k) return;
        setFetched((s) => ({ ...s, loading: false, error: { error: navigator.onLine ? "CrossMetric can't be reached right now." : "You're offline.", kind: "unavailable", offline: !navigator.onLine } }));
        return;
      }
      const json = (await res.json().catch(() => null)) as (ArriveByResponse & Partial<JourneyApiError>) | null;
      if (c.signal.aborted || latest.current.key !== k) return;
      if (!res.ok || !json || json.error || !json.basis) {
        setFetched((s) => ({ ...s, loading: false, error: { error: json?.error ?? "Your arrival plan couldn't be calculated right now.", kind: json?.kind ?? "unavailable", field: json?.field } }));
        return;
      }
      setFetched({ key: k, result: json, error: null, loading: false });
    })();
  }, []);

  // Plans as soon as the inputs are complete, and again after each edit (debounced).
  useEffect(() => {
    if (!key || key === fetched.key) return;
    const t = setTimeout(run, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [key, fetched.key, run]);
  useEffect(() => () => ctrl.current?.abort(), []);

  const result = fetched.key === key ? fetched.result : null;
  const previous = fetched.result;
  const plan: ArrivalPlan | null = useMemo(() => {
    const r = result ?? previous;
    if (!r) return null;
    // Planned as of when the routes were calculated, so feasibility matches the times shown.
    return buildArrivalPlan({ ...r.basis, now: r.generatedAt, prefer, preferredPlaceId });
  }, [result, previous, prefer, preferredPlaceId]);
  const shown = result ?? previous;
  const optionById = useMemo(() => new Map((shown?.basis.options ?? []).map((x) => [x.id, x] as const)), [shown]);
  const lateOption = shown?.basis.late?.option ?? null;
  const option = (id: string | null | undefined): JourneyOption | null => (id ? (optionById.get(id) ?? (lateOption?.id === id ? lateOption : null)) : null);

  let phase: ArrivePhase;
  if (!destination) phase = "needs_destination";
  else if (!o.origin) phase = "needs_origin";
  else if (!timing.ok) phase = timing.problem === "past" ? "passed" : "needs_time";
  else if (fetched.error && !fetched.loading) phase = fetched.error.offline || !o.online ? "offline" : "error";
  else if (!result) phase = previous && fetched.loading ? "updating" : "loading";
  else if (o.now - result.generatedAt > ARRIVE_STALE_MS || (plan?.primary && plan.primary.window.leaveBy < o.now - 60_000)) phase = "stale";
  else phase = "ready";

  const setDestination = useCallback((p: JourneyPlace | null) => {
    setStored((s) => ({ ...s, destination: p }));
    setPreferredPlaceId(null);
  }, [setStored]);
  const setPrefer = useCallback((p: ArrivePreference) => setStored((s) => ({ ...s, prefer: p })), [setStored]);
  const setArriveBy = useCallback((t: number) => {
    setArriveByState(t);
    setParkUntil((u) => (u !== null && u <= t ? null : u));
  }, []);

  return {
    destination,
    arriveBy,
    timingError: timing.ok ? null : timing.message,
    prefer,
    parkUntil,
    preferredPlaceId,
    phase,
    loading: fetched.loading,
    error: fetched.error,
    result: shown,
    /** The plan is for the inputs on screen (not an older result kept while updating). */
    current: !!result,
    plan,
    option,
    setDestination,
    setArriveBy,
    setPrefer,
    setParkUntil,
    choosePlace: setPreferredPlaceId,
    formOpen,
    setFormOpen,
    run,
  };
}

export type ArriveBy = ReturnType<typeof useArriveBy>;
