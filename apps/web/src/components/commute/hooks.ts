"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CampusBundle, CampusId, CommuteApiError, ParkingResponse, PlanRequest, PlanResponse, StopView, WeatherView } from "@/lib/commute-types";
import type { NearbyResponse } from "@/lib/nearby-types";
import { loadPlanCache, savePlanCache } from "@/lib/commute-store";

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw { error: "You're offline or CrossMetric can't be reached.", kind: "unavailable" } satisfies CommuteApiError;
  }
  const json = (await res.json().catch(() => null)) as (T & Partial<CommuteApiError>) | null;
  if (!res.ok || !json) throw { error: json?.error ?? "Something went wrong.", kind: json?.kind ?? "unavailable" } satisfies CommuteApiError;
  return json;
}

const post = <T,>(url: string, body: unknown, signal?: AbortSignal) => getJson<T>(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });

/** Current time, re-rendering every `everyMs`. */
export function useNow(everyMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    const onVisible = () => document.visibilityState === "visible" && setNow(Date.now());
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [everyMs]);
  return now;
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("online", cb);
      window.addEventListener("offline", cb);
      return () => {
        window.removeEventListener("online", cb);
        window.removeEventListener("offline", cb);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}

export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

const bundles = new Map<CampusId, Promise<CampusBundle>>();

export function useCampusBundle(campus: CampusId | null) {
  const [state, setState] = useState<{ campus: CampusId | null; data: CampusBundle | null; error: string | null }>({ campus: null, data: null, error: null });
  useEffect(() => {
    if (!campus) return;
    let p = bundles.get(campus);
    if (!p) {
      p = getJson<CampusBundle>(`/api/commute/campus?id=${campus}`);
      bundles.set(campus, p);
      p.catch(() => bundles.delete(campus));
    }
    let live = true;
    p.then((data) => live && setState({ campus, data, error: null })).catch((e: CommuteApiError) => live && setState({ campus, data: null, error: e.error }));
    return () => {
      live = false;
    };
  }, [campus]);
  return state.campus === campus ? state : { campus, data: null, error: null };
}

export type PlanInput = (Omit<PlanRequest, "deadline"> & { deadline: number | null; departNow: boolean }) | null;

/**
 * Plan for the current destination. Recomputes when inputs change, refreshes every
 * 5 minutes while the app is visible and departure is within 3 hours, and falls back
 * to the last saved plan (labelled with its age) when offline.
 */
export function usePlan(input: PlanInput, now: number) {
  const key = input ? JSON.stringify({ ...input, deadline: input.departNow ? null : input.deadline }) : null;
  const [state, setState] = useState<{ key: string | null; plan: PlanResponse | null; loading: boolean; error: CommuteApiError | null; updatedAt: number | null; cached: boolean }>({ key: null, plan: null, loading: false, error: null, updatedAt: null, cached: false });
  const ctrl = useRef<AbortController | null>(null);
  const inputRef = useRef(input);
  useLayoutEffect(() => {
    inputRef.current = input;
  });

  const run = useCallback(() => {
    const req = inputRef.current;
    if (!req || !key) return;
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setState((s) => ({ ...s, key, loading: true, error: null, plan: s.key === key ? s.plan : null, cached: s.key === key ? s.cached : false }));
    post<PlanResponse>("/api/commute/plan", { ...req, deadline: req.deadline ?? Date.now() }, c.signal)
      .then((plan) => {
        setState({ key, plan, loading: false, error: null, updatedAt: Date.now(), cached: false });
        savePlanCache({ key, plan, savedAt: Date.now() });
      })
      .catch((error: CommuteApiError | Error) => {
        if ((error as Error).name === "AbortError") return;
        const cached = loadPlanCache();
        // A "leave now" plan describes the moment it was made: an old one is never shown as current.
        const usable = cached && cached.key === key && (!req.departNow || Date.now() - cached.savedAt < 15 * 60_000);
        if (usable) setState({ key, plan: cached.plan, loading: false, error: error as CommuteApiError, updatedAt: cached.savedAt, cached: true });
        else setState((s) => ({ ...s, key, loading: false, error: error as CommuteApiError }));
      });
  }, [key]);

  useEffect(() => {
    if (!key) return;
    const t = setTimeout(run, 0);
    return () => clearTimeout(t);
  }, [key, run]);

  // Periodic refresh only while departure is near and the page is visible.
  const leaveBy = state.plan?.recommended?.leaveBy ?? null;
  useEffect(() => {
    if (!key || !state.updatedAt || document.visibilityState !== "visible") return;
    const near = leaveBy !== null && leaveBy - now < 3 * 3600_000;
    if (near && now - state.updatedAt > 5 * 60_000 && !state.loading) run();
  }, [now, key, leaveBy, state.updatedAt, state.loading, run]);

  useEffect(() => () => ctrl.current?.abort(), []);
  const current = state.key === key ? state : { plan: null, loading: !!key, error: null, updatedAt: null, cached: false };
  return { ...current, refresh: run };
}

export function useParking(body: { campus: CampusId; vehicle: { permits: string[]; registered: boolean | null }; at: number; until: number | null; near: [number, number] | null } | null) {
  const key = body ? JSON.stringify({ ...body, at: Math.round(body.at / 60_000) }) : null;
  const [state, setState] = useState<{ key: string | null; data: ParkingResponse | null; error: string | null }>({ key: null, data: null, error: null });
  const bodyRef = useRef(body);
  useLayoutEffect(() => {
    bodyRef.current = body;
  });
  const load = useCallback(() => {
    if (!key || !bodyRef.current) return;
    const c = new AbortController();
    post<ParkingResponse>("/api/commute/parking", bodyRef.current, c.signal)
      .then((data) => setState({ key, data, error: null }))
      .catch((e: CommuteApiError | Error) => (e as Error).name !== "AbortError" && setState({ key, data: null, error: (e as CommuteApiError).error }));
    return c;
  }, [key]);
  useEffect(() => {
    const c = load();
    return () => c?.abort();
  }, [load]);
  return { data: state.key === key ? state.data : null, error: state.key === key ? state.error : null, loading: !!key && state.key !== key, refresh: load };
}

export function useStops(campus: CampusId | null, point: [number, number] | null, stopId: string | null) {
  const key = campus && point ? `${campus}|${point[0].toFixed(5)}|${point[1].toFixed(5)}|${stopId ?? ""}` : null;
  const [state, setState] = useState<{ key: string | null; stops: StopView[] | null; at: number | null; error: string | null }>({ key: null, stops: null, at: null, error: null });
  useEffect(() => {
    if (!key || !point || !campus) return;
    const c = new AbortController();
    const qs = new URLSearchParams({ campus, lon: String(point[0]), lat: String(point[1]) });
    if (stopId) qs.set("stop", stopId);
    getJson<{ stops: StopView[]; now: number }>(`/api/commute/stops?${qs}`, { signal: c.signal })
      .then((r) => setState({ key, stops: r.stops, at: r.now, error: null }))
      .catch((e: CommuteApiError | Error) => (e as Error).name !== "AbortError" && setState({ key, stops: null, at: null, error: (e as CommuteApiError).error }));
    return () => c.abort();
  }, [key, campus, point, stopId]);
  return state.key === key ? state : { key, stops: null, at: null, error: null };
}

export function useWeather(point: [number, number] | null, at: number | null) {
  const key = point ? `${point[0].toFixed(3)},${point[1].toFixed(3)},${at ? Math.round(at / 600_000) : "now"}` : null;
  const [state, setState] = useState<{ key: string | null; data: WeatherView | null }>({ key: null, data: null });
  useEffect(() => {
    if (!key || !point) return;
    const c = new AbortController();
    const qs = new URLSearchParams({ lon: String(point[0]), lat: String(point[1]) });
    if (at) qs.set("at", String(at));
    getJson<WeatherView>(`/api/commute/weather?${qs}`, { signal: c.signal })
      .then((data) => setState({ key, data }))
      .catch(() => setState({ key, data: null }));
    return () => c.abort();
  }, [key, point, at]);
  return state.key === key ? state.data : null;
}

/**
 * Stations and stops near a point, ranked by walking time. The point goes in the
 * request body (never the URL). Keyed by the point and filter, so a result is only
 * shown for the place it was computed for.
 */
export function useNearby(point: [number, number] | null, railOnly: boolean, walkSpeedMps: number) {
  const key = point ? `${point[0].toFixed(5)},${point[1].toFixed(5)}|${railOnly}|${walkSpeedMps}` : null;
  const [state, setState] = useState<{ key: string | null; data: NearbyResponse | null; error: string | null }>({ key: null, data: null, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!key || !point) return;
    const c = new AbortController();
    post<NearbyResponse>("/api/transit/nearby", { lon: point[0], lat: point[1], railOnly, walkSpeedMps }, c.signal)
      .then((data) => setState({ key, data, error: null }))
      .catch((e: CommuteApiError | Error) => (e as Error).name !== "AbortError" && setState({ key, data: null, error: (e as CommuteApiError).error ?? "Transit data couldn't be loaded." }));
    return () => c.abort();
    // point is captured through key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);
  const current = state.key === key ? state : { key, data: null, error: null };
  return { ...current, loading: !!key && state.key !== key, refresh: () => setTick((t) => t + 1) };
}
