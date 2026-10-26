"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { decodePlace, encodePlace, parseMode } from "@/lib/place-url";
import type { ApiError, CurbResult, ModeComparison, Place, PlannerMode, TripResult } from "@/lib/trip-types";
import { routedMode } from "@/lib/trip-types";

export type When = { kind: "now" } | { kind: "at"; local: string };

export type Loadable<T> = { status: "idle" } | { status: "loading"; previous?: T } | { status: "done"; data: T } | { status: "error"; error: ApiError; previous?: T };

async function postJson<T>(url: string, body: unknown, signal: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw { error: "CrossMetric could not be reached. Check your connection and try again.", kind: "unavailable" } satisfies ApiError;
  }
  const json = (await res.json().catch(() => null)) as (T & Partial<ApiError>) | null;
  if (!res.ok || !json) throw { error: json?.error ?? "Something went wrong.", kind: json?.kind ?? "unavailable" } satisfies ApiError;
  return json;
}

function previousOf<T>(l: Loadable<T>): T | undefined {
  return l.status === "done" ? l.data : l.status === "loading" || l.status === "error" ? l.previous : undefined;
}

export interface TripPlannerOptions {
  /** Used when the URL has no trip (e.g. the dashboard's example trip). */
  fallback?: { from: Place; to: Place; mode: PlannerMode };
  /** Keep from/to/mode in the URL (never "My location"). */
  syncUrl?: boolean;
  /** Raw `from`, `to` and `mode` search params, passed from the server page so the first render matches. */
  params?: { from?: string | null; to?: string | null; mode?: string | null };
}

/**
 * Trip planner state shared by the Dashboard and Routes pages:
 * places, mode and time; the scored routes; the mode comparison; and the
 * safer pickup / drop-off comparison for rideshare trips.
 */
export function useTripPlanner({ fallback, syncUrl = true, params }: TripPlannerOptions = {}) {
  const [initial] = useState(() => {
    const from = decodePlace(params?.from ?? null);
    const to = decodePlace(params?.to ?? null);
    const mode = parseMode(params?.mode ?? null, fallback?.mode ?? "walk");
    return { from, to, mode, fromUrl: !!(from && to) };
  });
  const isExample = !initial.fromUrl && !!fallback;
  const [from, setFrom] = useState<Place | null>(initial.from ?? (isExample ? fallback!.from : null));
  const [to, setTo] = useState<Place | null>(initial.to ?? (isExample ? fallback!.to : null));
  const [mode, setMode] = useState<PlannerMode>(initial.mode);
  const [when, setWhen] = useState<When>({ kind: "now" });
  const [example, setExample] = useState(isExample);
  const [trip, setTrip] = useState<Loadable<TripResult>>({ status: "idle" });
  const [modes, setModes] = useState<Loadable<ModeComparison>>({ status: "idle" });
  const [curb, setCurb] = useState<Loadable<CurbResult>>({ status: "idle" });
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [locating, setLocating] = useState<"from" | "to" | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const controllers = useRef<{ trip?: AbortController; modes?: AbortController; curb?: AbortController }>({});

  const run = useCallback(
    (override?: { from?: Place | null; to?: Place | null; mode?: PlannerMode }) => {
      const f = override?.from !== undefined ? override.from : from;
      const t = override?.to !== undefined ? override.to : to;
      const m = override?.mode ?? mode;
      if (!f || !t) return;
      if (syncUrl) {
        // Example places stay out of the URL, so a reload shows them as the example again, never as the person's own trip.
        const isExample = (p: Place) => !!fallback && (p === fallback.from || p === fallback.to);
        const params = new URLSearchParams(window.location.search);
        const ef = isExample(f) ? null : encodePlace(f);
        const et = isExample(t) ? null : encodePlace(t);
        if (ef) params.set("from", ef);
        else params.delete("from");
        if (et) params.set("to", et);
        else params.delete("to");
        params.set("mode", m);
        window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
      }
      controllers.current.trip?.abort();
      controllers.current.modes?.abort();
      controllers.current.curb?.abort();
      setCurb({ status: "idle" });
      const routed = routedMode(m);
      if (routed) {
        const c = new AbortController();
        controllers.current.trip = c;
        setTrip((prev) => ({ status: "loading", previous: previousOf(prev) }));
        postJson<TripResult>("/api/trips", { from: f, to: t, mode: routed }, c.signal)
          .then((data) => {
            setTrip({ status: "done", data });
            setSelectedRouteId(data.routes.find((r) => r.roles.includes("safest"))?.id ?? data.routes[0]?.id ?? null);
          })
          .catch((error: ApiError | Error) => {
            if ((error as Error).name === "AbortError") return;
            setTrip((prev) => ({ status: "error", error: error as ApiError, previous: previousOf(prev) }));
          });
      } else {
        setTrip({ status: "idle" });
      }
      const mc = new AbortController();
      controllers.current.modes = mc;
      setModes((prev) => ({ status: "loading", previous: previousOf(prev) }));
      postJson<ModeComparison>("/api/modes", { from: f, to: t }, mc.signal)
        .then((data) => setModes({ status: "done", data }))
        .catch((error: ApiError | Error) => {
          if ((error as Error).name === "AbortError") return;
          setModes((prev) => ({ status: "error", error: error as ApiError, previous: previousOf(prev) }));
        });
    },
    [from, to, mode, syncUrl, fallback],
  );

  const loadCurb = useCallback((purpose: "pickup" | "dropoff", place: Place) => {
    controllers.current.curb?.abort();
    const c = new AbortController();
    controllers.current.curb = c;
    setCurb((prev) => ({ status: "loading", previous: previousOf(prev) }));
    postJson<CurbResult>("/api/curb", { place, purpose }, c.signal)
      .then((data) => setCurb({ status: "done", data }))
      .catch((error: ApiError | Error) => {
        if ((error as Error).name === "AbortError") return;
        setCurb({ status: "error", error: error as ApiError });
      });
  }, []);

  // Run once on mount when a trip is known (from the URL or the example).
  useEffect(() => {
    if (!initial.from && !isExample) return;
    const t = setTimeout(() => run(), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const useMyLocation = useCallback((target: "from" | "to") => {
    setLocationError(null);
    if (!("geolocation" in navigator)) {
      setLocationError("This browser cannot share a location. Enter a starting point instead.");
      return;
    }
    setLocating(target);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { longitude: lon, latitude: lat } = pos.coords;
        setLocating(null);
        if (lon < -85.65 || lon > -80.8 || lat < 30.33 || lat > 35.03) {
          setLocationError("Your location appears to be outside Georgia. CrossMetric covers Georgia; enter a starting point instead.");
          return;
        }
        const place: Place = { label: "My location", lon, lat, kind: "current" };
        try {
          const res = await fetch("/api/places/reverse", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lon, lat }) });
          const body = (await res.json()) as { label?: string | null };
          if (body.label) place.sublabel = `Near ${body.label}`;
        } catch {
          // The label is a nicety; the coordinates are what matter.
        }
        setExample(false);
        if (target === "from") setFrom(place);
        else setTo(place);
      },
      (err) => {
        setLocating(null);
        setLocationError(
          err.code === err.PERMISSION_DENIED
            ? "CrossMetric could not access your location. Enter a starting point instead."
            : "Your location could not be determined right now. Enter a starting point instead.",
        );
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }, []);

  const swap = useCallback(() => {
    setFrom(to);
    setTo(from);
    setExample(false);
  }, [from, to]);

  const tripData = previousOf(trip);
  // The example places are the fallback objects themselves; anything the person picks is a new object.
  const examplePlaces = !!fallback && (from === fallback.from || from === fallback.to || to === fallback.to || to === fallback.from);
  const selectedRoute = useMemo(() => tripData?.routes.find((r) => r.id === selectedRouteId) ?? tripData?.routes[0] ?? null, [tripData, selectedRouteId]);

  return {
    from,
    to,
    mode,
    when,
    example,
    /** True while either end of the trip is still the built-in example place. */
    examplePlaces,
    setFrom: (p: Place | null) => {
      setExample(false);
      setFrom(p);
    },
    setTo: (p: Place | null) => {
      setExample(false);
      setTo(p);
    },
    setMode: (m: PlannerMode) => {
      setExample(false);
      setMode(m);
    },
    setWhen,
    swap,
    run,
    trip,
    tripData,
    modes,
    modesData: previousOf(modes),
    curb,
    loadCurb,
    selectedRoute,
    selectedRouteId: selectedRoute?.id ?? null,
    setSelectedRouteId,
    useMyLocation,
    locating,
    locationError,
    clearLocationError: () => setLocationError(null),
  };
}

export type TripPlanner = ReturnType<typeof useTripPlanner>;
