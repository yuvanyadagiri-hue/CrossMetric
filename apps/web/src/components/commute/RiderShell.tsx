"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Bell, MapPin, MapPinned, Search, ShieldCheck, UserRound, X } from "lucide-react";
import { LogoTile } from "@/components/brand/Logo";
import { addDays, dedupeOccurrences, DEFAULT_TRAVEL_PREFERENCES, expandManual, expandPlaceAlias, JOURNEY_MODES, LEAVE_NOW, localDate, nextClass as findNextClass, type ClassOccurrence, type JourneyMode, type TripIntent, type TripTiming } from "@crossmetric/engine/commute";
import type { CampusId, LonLat, ParkingResult, PlanLeg } from "@/lib/commute-types";
import { applySeries } from "@/lib/ics-series";
import { normalizeTravel, type SearchOverrides } from "@/lib/journey-client";
import { MODE_LABEL, type JourneyPlace, type JourneyResponse } from "@/lib/journey-types";
import { useActiveTrip, useParkedCar, usePrefs, useSavedPlaces, useSchedule, useTripHistory, type SavedPlace } from "@/lib/commute-store";
import { reportStatus, verificationLevel } from "@/lib/reports";
import { readSharedTrip, SHARE_KEYS, type SharedTrip } from "@/lib/share";
import { BottomSheet, type Snap } from "./BottomSheet";
import { CommuteMap, type MapReport, type MapStation, type MapStop } from "./CommuteMap";
import { tz } from "./format";
import { useCampusBundle, useMedia, useNearby, useNow, useOnline, useParking, usePlan, type PlanInput } from "./hooks";
import type { AppModel, ArrivedSummary, ParkingTiming, PickTarget, SearchIntent, View } from "./model";
import { tabOf, type Tab } from "./model";
import { NavRail, TabBar } from "./Navigation";
import { optionTitle } from "./journey-ui";
import { ArriveFooter, arriveParkingStatus } from "./panels/ArrivePanel";
import { CommunityFooter } from "./panels/CommunityPanel";
import { DetailFooter } from "./panels/DetailPanel";
import type { NearbyFilter, NearbyState } from "./panels/NearbyPanel";
import { visibleParking } from "./panels/ParkingPanel";
import { PlanFooter } from "./panels/PlanPanel";
import { ReportFooter } from "./panels/ReportPanel";
import type { PickResult } from "./PlacePicker";
import { RiderProvider } from "./rider-context";
import { PAGE_KINDS, parentView, TAB_ROOTS, viewFromLocation, viewHref } from "./routes";
import { SidePanel } from "./SidePanel";
import { useCommunityReports, useReportFlow } from "./useCommunity";
import { useArriveBy } from "./useArriveBy";
import { useJourney } from "./useJourney";
import { useReminders } from "./useReminders";
import { hasSeenWelcome } from "./welcome-state";

type ScreenDir = "forward" | "back" | "tab";

/** What each panel is called for assistive tech. */
const PANEL_LABEL: Partial<Record<View["kind"], string>> = { home: "Explore", plan: "Routes", detail: "Route details", trip: "Trip", report: "Report a barrier", community: "Community", nearby: "Transit near you", parking: "Parking", night: "Night travel", arrive: "Arrive by", profile: "Account", search: "Search" };
const TOAST_MS = 6000;

type ShortcutView = "nearby" | "saved" | "profile" | "services" | "activity";
/** Installed-app shortcuts and older links (`/?view=…`) now open the real page. */
const SHORTCUT_PATH: Record<ShortcutView, string> = { nearby: "/nearby", saved: "/account/places", profile: "/account", services: "/services", activity: "/activity" };

/** What the page was opened with: a shared trip link, or an app shortcut to a screen. */
function readIncoming(search: string, now: number): { trip: SharedTrip | null; view: ShortcutView | null } | null {
  const params = new URLSearchParams(search);
  const view = params.get("view");
  if (view && view in SHORTCUT_PATH) return { trip: null, view: view as ShortcutView };
  if (!SHARE_KEYS.some((k) => params.has(k))) return null;
  const trip = readSharedTrip(params, now);
  return trip ? { trip, view: null } : null;
}

/** Map screens with the floating destination search on a phone (Explore has its own search bar; Routes has its fields). */
const MAP_SEARCH_VIEWS = new Set<View["kind"]>(["nearby", "parking", "night", "stop", "parked", "return"]);
/** The size each sheet opens at when nothing said otherwise. */
const DEFAULT_SNAP: Partial<Record<View["kind"], Snap>> = { plan: "half", arrive: "half", nearby: "half", parking: "half", night: "half", parked: "half", return: "half", detail: "full", report: "half", community: "half" };
/** The phone tab bar's height (without the home-indicator inset). */
const TABBAR_H = 64;
/** Desktop geometry (premium.css --cm-rail-w and --cm-panel-w). */
const RAIL_W = 76;

/** Client-only: everything personal lives in this browser's storage. */
export function RiderShell({ children }: { children: React.ReactNode }) {
  // False during server rendering and hydration, true in the browser.
  const mounted = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
  if (!mounted) {
    return (
      <div className="cm-app absolute inset-0" data-theme="dark">
        <main id="main" className="grid h-full place-items-center bg-[#07111F]">
          <p className="sr-only" role="status">
            Loading CrossMetric…
          </p>
        </main>
      </div>
    );
  }
  return <Shell>{children}</Shell>;
}

const destKey = (p: JourneyPlace | null) => (p ? `${p.lon},${p.lat},${p.label}` : "");

async function geocodeFirst(q: string): Promise<JourneyPlace | null> {
  try {
    const r = await fetch(`/api/places?q=${encodeURIComponent(q)}`);
    const body = (await r.json()) as { results: { label: string; sublabel?: string; lon: number; lat: number }[] };
    const h = body.results[0];
    return h ? { label: h.label, sublabel: h.sublabel ?? null, lon: h.lon, lat: h.lat, source: "place" } : null;
  } catch {
    return null;
  }
}

async function reverseLabel(p: LonLat): Promise<string | null> {
  try {
    const r = await fetch("/api/places/reverse", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lon: p[0], lat: p[1] }) });
    const body = (await r.json()) as { label?: string | null };
    return body.label ?? null;
  } catch {
    return null;
  }
}

/** The walking route from the nearby anchor to the selected station (a walk-only journey). */
function useStationWalk(anchor: JourneyPlace | null, station: { lon: number; lat: number; name: string } | null, walkSpeedMps: number) {
  const key = anchor && station ? `${anchor.lon},${anchor.lat}>${station.lon},${station.lat}` : null;
  const [state, setState] = useState<{ key: string | null; legs: PlanLeg[] | null; minutes: number; meters: number | null }>({ key: null, legs: null, minutes: 0, meters: null });
  useEffect(() => {
    if (!key || !anchor || !station) return;
    const c = new AbortController();
    const body = {
      origin: anchor,
      destination: { label: station.name, lon: station.lon, lat: station.lat, source: "station" },
      timing: { mode: "now" },
      prefs: { ...DEFAULT_TRAVEL_PREFERENCES, modes: { walk: true, bike: false, transit: false, drive: false, park_ride: false } },
      vehicle: { hasCar: false },
      walkSpeedMps,
    };
    fetch("/api/journey/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: c.signal })
      .then((r) => r.json() as Promise<JourneyResponse>)
      .then((r) => {
        const o = r.options?.[0];
        setState({ key, legs: o ? o.legs : null, minutes: o?.durationMin ?? 0, meters: o?.distanceM ?? null });
      })
      .catch((e: Error) => e.name !== "AbortError" && setState({ key, legs: null, minutes: 0, meters: null }));
    return () => c.abort();
    // anchor/station are captured through key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, walkSpeedMps]);
  return { legs: state.key === key ? state.legs : null, minutes: state.minutes, meters: state.meters, loading: !!key && state.key !== key };
}

function Shell({ children }: { children: React.ReactNode }) {
  const now = useNow(15_000);
  const online = useOnline();
  const reducedMotion = useMedia("(prefers-reduced-motion: reduce)");
  // Desktop: a rail and a side panel beside the map. Phone and tablet: the map, a sheet and a tab bar.
  const desktop = useMedia("(min-width: 1024px)");
  const widePanel = useMedia("(min-width: 1280px)");
  const layout: AppModel["layout"] = desktop ? "desktop" : "mobile";
  const panelLeft = desktop ? RAIL_W + (widePanel ? 420 : 400) : 0;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [prefs, setPrefs] = usePrefs();
  const campus: CampusId | null = prefs.campus;
  const { data: bundle, error: bundleError } = useCampusBundle(campus);
  const buildings = useMemo(() => new Map((bundle?.buildings ?? []).map((b) => [b.id, b])), [bundle]);
  const [schedule, setSchedule] = useSchedule();
  const [parked, setParked] = useParkedCar();
  const [trip, setTrip] = useActiveTrip();
  const [, setPlaces] = useSavedPlaces();

  // Classes in the planning window (yesterday through two weeks ahead), this campus only.
  const today = localDate(now, tz);
  const occurrences = useMemo(() => {
    if (!campus) return [] as ClassOccurrence[];
    const from = addDays(today, -1);
    const to = addDays(today, 14);
    const manual = schedule.manual.filter((c) => c.campus === campus).flatMap((c) => expandManual(c, from, to));
    const imported =
      schedule.imported && schedule.imported.campus === campus
        ? applySeries(schedule.imported.occurrences, schedule.imported.series).map((o) => (schedule.overrides[o.key]?.include !== undefined ? { ...o, include: schedule.overrides[o.key]!.include! } : o))
        : [];
    return dedupeOccurrences([...manual, ...imported]).filter((o) => !o.buildingId || buildings.size === 0 || buildings.has(o.buildingId));
  }, [schedule, campus, today, buildings]);
  const nextClass = useMemo(() => findNextClass(occurrences, now), [occurrences, now]);

  // Location: asked for only when the person taps something that needs it.
  const [userLocation, setUserLocation] = useState<LonLat | null>(null);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const [locationPermission, setLocationPermission] = useState<AppModel["locationPermission"]>("unknown");
  useEffect(() => {
    let status: PermissionStatus | null = null;
    const update = () => status && setLocationPermission(status.state as AppModel["locationPermission"]);
    navigator.permissions
      ?.query({ name: "geolocation" as PermissionName })
      .then((s) => {
        status = s;
        update();
        s.addEventListener("change", update);
      })
      .catch(() => undefined);
    return () => status?.removeEventListener("change", update);
  }, []);
  const locate = useCallback(
    () =>
      new Promise<LonLat | null>((resolve) => {
        setLocError(null);
        if (!("geolocation" in navigator)) {
          setLocError("Location isn't available in this browser. Enter an address instead.");
          resolve(null);
          return;
        }
        setLocating(true);
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            setLocating(false);
            const ll: LonLat = [pos.coords.longitude, pos.coords.latitude];
            if (ll[0] < -85.65 || ll[0] > -80.8 || ll[1] < 30.33 || ll[1] > 35.03) {
              setLocError("You appear to be outside Georgia. Enter a start in Georgia instead.");
              resolve(null);
              return;
            }
            setUserLocation(ll);
            resolve(ll);
          },
          (err) => {
            setLocating(false);
            setLocError(err.code === err.PERMISSION_DENIED ? "Location is off for this site. Enter an address instead." : "Couldn't get your location. Enter an address instead.");
            resolve(null);
          },
          { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
        );
      }),
    [],
  );
  const currentPlace = useCallback(async (): Promise<JourneyPlace | null> => {
    const ll = await locate();
    return ll ? { label: "Current location", lon: ll[0], lat: ll[1], source: "current" } : null;
  }, [locate]);

  // The journey: any start and destination in Georgia, explicit timing, the person's preferences.
  const travel = useMemo(() => normalizeTravel(prefs.travel), [prefs.travel]);
  const vehicle = useMemo(() => ({ hasCar: prefs.hasCar, permits: prefs.permits, registered: prefs.registered, mpg: prefs.mpg }), [prefs.hasCar, prefs.permits, prefs.registered, prefs.mpg]);
  const journey = useJourney({ travel, vehicle, fuelPrice: prefs.fuelPrice, walkSpeedMps: prefs.walkSpeedMps, online, now, keepHistory: prefs.keepHistory });
  const dest = journey.destination;
  const destBuilding = dest?.buildingId && dest.campus === campus ? (buildings.get(dest.buildingId) ?? null) : null;
  // ArriveBy shares the trip's start; its destination and time are its own.
  const arrive = useArriveBy({ origin: journey.origin, travel, vehicle, fuelPrice: prefs.fuelPrice, walkSpeedMps: prefs.walkSpeedMps, online, now });
  const arriveDest = arrive.destination;
  const arriveBuilding = arriveDest?.buildingId && arriveDest.campus === campus ? (buildings.get(arriveDest.buildingId) ?? null) : null;

  // Plan for the next class (its own card and reminders); never feeds ordinary searches.
  const classOrigin = prefs.origin;
  const classPlanInput: PlanInput = useMemo(() => {
    if (!campus || !bundle || !nextClass?.buildingId || !classOrigin || !buildings.has(nextClass.buildingId)) return null;
    return {
      campus,
      origin: { lon: classOrigin.lon, lat: classOrigin.lat, label: classOrigin.label },
      buildingId: nextClass.buildingId,
      deadline: nextClass.start - prefs.entryBufferMin * 60_000,
      departNow: false,
      parkUntil: null,
      vehicle: { permits: prefs.permits, registered: prefs.registered, hasCar: prefs.hasCar, mpg: prefs.mpg },
      fuelPrice: prefs.fuelPrice,
      walkSpeedMps: prefs.walkSpeedMps,
      modes: prefs.modes,
      parkAt: null,
    };
  }, [campus, bundle, nextClass, classOrigin, buildings, prefs.entryBufferMin, prefs.permits, prefs.registered, prefs.hasCar, prefs.mpg, prefs.fuelPrice, prefs.walkSpeedMps, prefs.modes]);
  const classPlan = usePlan(classPlanInput, now);

  // Parking timing: its own arrival and stay, never the route search's time.
  const [parkingTiming, setParkingTiming] = useState<ParkingTiming>({ at: null, until: null, untilSource: null });

  // Camera requests from panels (a report location found by search, "use my location").
  const [flyReq, setFlyReq] = useState<{ point: LonLat; key: number } | null>(null);
  const flyTo = useCallback((p: LonLat) => setFlyReq({ point: p, key: Date.now() }), []);

  // ---- Navigation: every screen is a page with its own address. ----
  const view = useMemo<View>(() => viewFromLocation(pathname, searchParams) ?? { kind: "home" }, [pathname, searchParams]);
  const tab = tabOf(view);

  // The report being written (kept here so it survives a trip to the search page and back).
  const report = useReportFlow();
  // Community reports: loaded when a screen that shows them first opens.
  const community = useCommunityReports(view.kind === "home" || view.kind === "report" || view.kind === "community");
  // While the report's location is chosen, the map's centre is the pin; its address is looked up after the map rests.
  const reportPicking = view.kind === "report" && report.step === "location";
  const [mapCenter, setMapCenter] = useState<LonLat | null>(null);
  const [pinLabel, setPinLabel] = useState<{ key: string; label: string | null } | null>(null);
  const pinKey = mapCenter ? `${mapCenter[0].toFixed(5)},${mapCenter[1].toFixed(5)}` : "";
  useEffect(() => {
    if (!reportPicking || !mapCenter) return;
    const c = mapCenter;
    const key = pinKey;
    let live = true;
    const t = setTimeout(() => {
      void reverseLabel(c).then((label) => live && setPinLabel({ key, label }));
    }, 450);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // mapCenter is captured through pinKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportPicking, pinKey]);
  const reportPin = reportPicking && mapCenter ? { lon: mapCenter[0], lat: mapCenter[1], label: pinLabel?.key === pinKey ? pinLabel.label : null, resolving: pinLabel?.key !== pinKey } : null;

  // The size each sheet opens at, remembered per screen.
  const [snaps, setSnaps] = useState<Partial<Record<View["kind"], Snap>>>({});
  const snap: Snap = snaps[view.kind] ?? DEFAULT_SNAP[view.kind] ?? "rest";
  const viewKind = view.kind;
  const setSnap = useCallback((s: Snap) => setSnaps((m) => ({ ...m, [viewKind]: s })), [viewKind]);

  // The screens visited inside the app, to tell going back from going forward and whether Back stays in the app.
  const [screen, setScreen] = useState<{ stack: { path: string; kind: View["kind"] }[]; dir: ScreenDir }>(() => ({ stack: [{ path: pathname, kind: view.kind }], dir: "tab" }));
  if (screen.stack[screen.stack.length - 1]!.path !== pathname) {
    const prev = screen.stack[screen.stack.length - 2];
    if (prev && prev.path === pathname) setScreen({ stack: screen.stack.slice(0, -1), dir: "back" });
    else {
      const last = screen.stack[screen.stack.length - 1]!;
      const dir: ScreenDir = TAB_ROOTS.has(last.kind) && TAB_ROOTS.has(view.kind) ? "tab" : "forward";
      setScreen({ stack: [...screen.stack, { path: pathname, kind: view.kind }].slice(-20), dir });
    }
  }
  const canGoBack = screen.stack.length > 1;

  const go = useCallback<AppModel["go"]>(
    (v, s = "rest", replace = false) => {
      setSnaps((m) => ({ ...m, [v.kind]: s }));
      const href = viewHref(v);
      // Home is a tab root: reaching it ends whatever flow came before it.
      if (replace || v.kind === "home") router.replace(href);
      else router.push(href);
    },
    [router],
  );
  const back = useCallback(() => {
    if (canGoBack) router.back();
    else router.replace(viewHref(parentView(view)));
  }, [canGoBack, router, view]);
  const onTab = useCallback(
    (t: Tab) => {
      if (t === "report" && report.step === "done") report.reset();
      const v: View = t === "explore" ? { kind: "home" } : t === "routes" ? { kind: "plan" } : t === "report" ? { kind: "report" } : t === "community" ? { kind: "community" } : { kind: "profile" };
      go(v, v.kind === "home" ? "rest" : v.kind === "profile" ? "full" : "half", true);
    },
    [go, report],
  );

  // First launch: the welcome pages come first (once). Skipped under automation, like the intro.
  const [incoming] = useState(() => (pathname === "/" ? readIncoming(window.location.search, Date.now()) : null));
  useEffect(() => {
    if (pathname !== "/" || incoming || hasSeenWelcome()) return;
    router.replace("/welcome");
  }, [pathname, incoming, router]);

  // A start for a new search: the current location if already shared, else a chosen or saved one; otherwise ask.
  const ensureOrigin = useCallback(async () => {
    if (journey.origin) return;
    if (locationPermission === "granted") {
      const p = await currentPlace();
      if (p) {
        journey.setOrigin(p);
        return;
      }
    }
    if (prefs.origin) journey.setOrigin({ ...prefs.origin, source: "saved" });
  }, [journey, locationPermission, currentPlace, prefs.origin]);

  // "Now" on Home: the time for the next search only (Leave now again afterwards).
  const [homeTiming, setHomeTiming] = useState<TripTiming>(LEAVE_NOW);
  const takeHomeTiming = useCallback((): TripTiming | undefined => {
    if (homeTiming.mode === "now") return undefined;
    setHomeTiming(LEAVE_NOW);
    return homeTiming;
  }, [homeTiming, setHomeTiming]);

  // A Services tile ("Walk", "Rideshare"...) shapes the next destination search.
  const pendingIntent = useRef<SearchIntent>(null);
  const [intentFor, setIntentFor] = useState<{ intent: SearchIntent; dest: string } | null>(null);
  const searchIntent: SearchIntent = intentFor && intentFor.dest === destKey(journey.destination) ? intentFor.intent : null;

  const planTo = useCallback(
    (d: JourneyPlace) => {
      setIntentFor(null);
      journey.startSearch(d, { timing: takeHomeTiming() });
      void ensureOrigin();
      go({ kind: "plan" }, "half");
    },
    [journey, ensureOrigin, go, takeHomeTiming],
  );

  const openArrive = useCallback<AppModel["openArrive"]>(
    (prefill = {}) => {
      const d = prefill.destination;
      if (d) {
        if (d.campus && d.campus !== campus) setPrefs((p) => ({ ...p, campus: d.campus! }));
        arrive.setDestination(d);
      }
      if (prefill.arriveBy && prefill.arriveBy > Date.now()) arrive.setArriveBy(prefill.arriveBy);
      // Everything chosen already: show the plan first, with the inputs folded into one line.
      arrive.setFormOpen(!(d && prefill.arriveBy));
      void ensureOrigin();
      go({ kind: "arrive" }, "half");
    },
    [campus, setPrefs, arrive, ensureOrigin, go],
  );

  const startTrip = useCallback<AppModel["startTrip"]>(
    (o, extra = {}) => {
      setTrip({ campus: extra.campus ?? null, option: o, buildingId: extra.buildingId ?? "", destLabel: extra.destLabel, fromLabel: extra.fromLabel, leg: 0, startedAt: Date.now(), occurrenceKey: extra.occurrenceKey ?? null });
      go({ kind: "trip" }, "rest", true);
    },
    [setTrip, go],
  );

  // Finished trips go to Activity (labels and times only) when history is on, and to the Arrived page.
  const [, setHistory] = useTripHistory();
  const [arrived, setArrived] = useState<ArrivedSummary | null>(null);
  const endTrip = useCallback(
    (completed: boolean) => {
      if (!trip) return;
      const legs = trip.option.legs;
      const title = optionTitle({ kind: trip.option.kind as JourneyMode, title: trip.option.title, legs });
      const to = trip.destLabel ?? (trip.buildingId ? "Class" : "Your destination");
      const plannedMin = Math.round(legs.reduce((sum, l) => sum + Math.max(0, l.minutes), 0));
      const endedAt = Date.now();
      if (prefs.keepHistory) {
        const entry = {
          id: crypto.randomUUID().slice(0, 8),
          title,
          kind: trip.option.kind,
          from: trip.fromLabel ?? null,
          to,
          startedAt: trip.startedAt,
          endedAt,
          plannedMin,
          completed,
          steps: legs.length,
          stepsDone: completed ? legs.length : Math.min(trip.leg, legs.length),
          costUsd: trip.option.costUsd ?? null,
        };
        setHistory((h) => [entry, ...h].slice(0, 30));
      }
      if (completed) setArrived({ title, kind: trip.option.kind, from: trip.fromLabel ?? null, to, plannedMin, tookMin: Math.max(1, Math.round((endedAt - trip.startedAt) / 60_000)), costUsd: trip.option.costUsd ?? null, steps: legs.length, endedAt });
      setTrip(null);
    },
    [trip, prefs.keepHistory, setHistory, setTrip],
  );
  const clearArrived = useCallback(() => setArrived(null), []);

  // One toast at a time; a new message restarts the timer (and its progress line).
  const [toastMsg, setToastMsg] = useState<{ text: string; id: number } | null>(null);
  const toastText = toastMsg?.text ?? null;
  const setToastText = useCallback((text: string | null) => setToastMsg(text ? { text, id: Date.now() } : null), []);
  const toast = setToastText as (m: string) => void;
  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [toastMsg]);

  // Nearby transit: around a chosen place, the shared location, the trip start or the saved start.
  const [nearbyAnchor, setNearbyAnchor] = useState<JourneyPlace | null>(null);
  const [nearbyFilter, setNearbyFilter] = useState<NearbyFilter>("all");
  const [nearbySelected, setNearbySelected] = useState<string | null>(null);
  const anchor: JourneyPlace | null = nearbyAnchor ?? (userLocation ? { label: "Current location", lon: userLocation[0], lat: userLocation[1], source: "current" } : (journey.origin ?? (prefs.origin ? { ...prefs.origin, source: "saved" } : null)));
  const nearbyActive = view.kind === "nearby" || view.kind === "home";
  const nearbyData = useNearby(nearbyActive && anchor ? [anchor.lon, anchor.lat] : null, nearbyFilter === "rail", prefs.walkSpeedMps);
  const stationsList = useMemo(() => nearbyData.data?.stations ?? [], [nearbyData.data]);
  const selectedStation = view.kind === "nearby" ? (stationsList.find((s) => s.id === nearbySelected) ?? null) : null;
  const walk = useStationWalk(view.kind === "nearby" ? anchor : null, selectedStation, prefs.walkSpeedMps);
  const nearby: NearbyState = {
    anchor,
    setAnchor: (p) => {
      setNearbyAnchor(p);
      setNearbySelected(null);
    },
    filter: nearbyFilter,
    setFilter: setNearbyFilter,
    stations: stationsList,
    nearestRail: nearbyData.data?.nearestRail ?? null,
    coverage: nearbyData.data?.coverage ?? null,
    notes: nearbyData.data?.notes ?? [],
    loading: nearbyData.loading,
    error: nearbyData.error,
    refresh: nearbyData.refresh,
    selectedId: nearbySelected,
    select: setNearbySelected,
    walk: walk.legs ? { minutes: walk.minutes, meters: walk.meters } : null,
    walkLoading: walk.loading,
  };

  // The search page and "choose on map".
  const [picking, setPicking] = useState<"origin" | "destination" | null>(null);
  const center = useRef<LonLat | null>(null);
  const openPicker = useCallback((target: PickTarget) => router.push(viewHref({ kind: "search", target })), [router]);
  const searchFor = useCallback(
    (m: SearchIntent) => {
      pendingIntent.current = m;
      openPicker("destination");
    },
    [openPicker],
  );
  const closeSearch = useCallback(() => {
    pendingIntent.current = null;
    back();
  }, [back]);

  // Basemap: dark by default (the brand), light, or following the appearance.
  const systemDark = useMedia("(prefers-color-scheme: dark)");
  const theme = prefs.appearance === "system" ? (systemDark ? "dark" : "light") : prefs.appearance;
  const mapTheme: "light" | "dark" = prefs.mapStyle === "auto" ? theme : prefs.mapStyle;
  const [cover, setCover] = useState({ bottom: 220, left: 0 });

  const setCampus = useCallback(
    (c: CampusId | null) => {
      setPrefs((p) => ({ ...p, campus: c }));
    },
    [setPrefs],
  );

  // Parking data for the parking screen (and the map's parking layer).
  const parkingActive = view.kind === "parking" && !!campus;
  const near: [number, number] | null = destBuilding
    ? destBuilding.entrances[0]
      ? [destBuilding.entrances[0].lon, destBuilding.entrances[0].lat]
      : destBuilding.center
    : dest && bundle && dest.lon >= bundle.bounds[0][0] && dest.lon <= bundle.bounds[1][0] && dest.lat >= bundle.bounds[0][1] && dest.lat <= bundle.bounds[1][1]
      ? [dest.lon, dest.lat]
      : null;
  const parking = useParking(parkingActive && bundle ? { campus: campus!, vehicle: { permits: prefs.permits, registered: prefs.registered }, at: parkingTiming.at ?? now, until: parkingTiming.until, near } : null);
  const parkingResults = useMemo(() => new Map((parking.data?.results ?? []).map((r) => [r.placeId, r])), [parking.data]);

  const openReport = useCallback<AppModel["openReport"]>(
    (at) => {
      report.reset();
      if (at) {
        report.setLocation({ lon: at.lon, lat: at.lat, label: at.label, source: "search" });
        report.setStep("category");
        flyTo([at.lon, at.lat]);
      }
      go({ kind: "report" }, "half");
    },
    [report, flyTo, go],
  );

  const onPick = async (target: PickTarget, r: PickResult) => {
    if (target !== "destination") pendingIntent.current = null;
    if (target === "report") {
      // Back to the map with the pin over the place found; the person confirms it there.
      back();
      if (r.map) return;
      const region = campus === "uga" ? "athens" : campus === "gt" ? "atlanta" : null;
      const place = r.place ?? (r.intent?.place ? await geocodeFirst(expandPlaceAlias(r.intent.place, region)) : null);
      if (place) {
        report.markPlaced();
        flyTo([place.lon, place.lat]);
      } else toast("Couldn't find that place in Georgia. Move the map to the barrier instead.");
      return;
    }
    if (r.map) {
      // Leave the search page; the map comes up with a pin to place.
      back();
      setPicking(target === "origin" ? "origin" : "destination");
      return;
    }
    const intent: TripIntent | null = r.intent;
    const region = campus === "uga" ? "athens" : campus === "gt" ? "atlanta" : null;
    const resolve = async () => r.place ?? (intent?.place ? await geocodeFirst(expandPlaceAlias(intent.place, region)) : null);
    if (target === "origin") {
      if (r.place) journey.setOrigin(r.place);
      back();
      return;
    }
    if (target === "arrive") {
      const place = await resolve();
      if (!place) {
        toast(intent?.place ? `Couldn't find "${intent.place}" in Georgia. Try a building name.` : "Choose a building from the list.");
        return;
      }
      if (place.campus && place.campus !== campus) setCampus(place.campus);
      arrive.setDestination(place);
      if (r.arriveBy) arrive.setArriveBy(r.arriveBy);
      void ensureOrigin();
      back();
      return;
    }
    if (target === "start") {
      if (r.place) setPrefs((x) => ({ ...x, origin: { lon: r.place!.lon, lat: r.place!.lat, label: r.place!.label } }));
      back();
      return;
    }
    if (target === "nearby") {
      if (r.place) nearby.setAnchor(r.place);
      go({ kind: "nearby" }, "half", true);
      return;
    }
    if (target === "save") {
      if (!r.place) {
        back();
        return;
      }
      const id = crypto.randomUUID().slice(0, 8);
      setPlaces((list) => [...list, { id, name: r.place!.label.slice(0, 40), kind: "other", place: { ...r.place!, source: "saved" }, savedAt: Date.now() }]);
      go({ kind: "saved", editId: id }, "full", true);
      return;
    }
    // Destination search, possibly a typed request.
    if (intent?.action === "nearby_transit") {
      const place = intent.place ? await resolve() : null;
      if (place) nearby.setAnchor(place);
      setNearbyFilter(intent.railOnly ? "rail" : "all");
      go({ kind: "nearby" }, "half", true);
      return;
    }
    if (intent?.action === "parking") {
      const place = await resolve();
      if (place) journey.setDestination(place);
      go({ kind: "parking" }, "half", true);
      return;
    }
    const place = await resolve();
    const tile = pendingIntent.current;
    pendingIntent.current = null;
    if (!place) {
      toast(intent?.place ? `Couldn't find "${intent.place}" in Georgia. Try an address.` : "Choose a place from the list.");
      return;
    }
    const typed: SearchOverrides | null = intent && intent.understood.length ? { modesOff: intent.modesOff, modesOn: intent.modesOn, prefer: intent.prefer, priority: intent.priority, maxTransfers: intent.maxTransfers, accessible: intent.accessible, understood: intent.understood } : null;
    // A mode tile from Services offers only that way of travelling, shown as a removable chip.
    const only: SearchOverrides | null = tile && tile !== "rideshare" ? { modesOff: JOURNEY_MODES.filter((m) => m !== tile), modesOn: [tile], prefer: [], priority: null, maxTransfers: null, accessible: false, understood: [`${MODE_LABEL[tile]} only`] } : null;
    const overrides = typed ?? only;
    if (place.campus && place.campus !== campus) setCampus(place.campus);
    setIntentFor(tile ? { intent: tile, dest: destKey(place) } : null);
    journey.startSearch(place, { overrides, timing: takeHomeTiming() });
    void ensureOrigin();
    go({ kind: "plan" }, "half", true);
  };

  const app: AppModel = {
    now,
    online,
    reducedMotion,
    prefs,
    setPrefs,
    campus,
    setCampus,
    bundle,
    bundleError,
    buildings,
    schedule,
    setSchedule,
    occurrences,
    nextClass,
    classPlan,
    journey,
    arrive,
    openArrive,
    nearby,
    destBuilding,
    origin: prefs.origin,
    setOrigin: (p: SavedPlace | null, source) => {
      if (source === "saved") setPrefs((x) => ({ ...x, origin: p }));
      else journey.setOrigin(p ? { ...p, source: source === "current" ? "current" : "place" } : null);
    },
    locate,
    locating,
    locError,
    userLocation,
    locationPermission,
    currentPlace,
    parkingTiming,
    setParkingTiming,
    parkUntil: parkingTiming.until,
    view,
    go,
    back,
    snap,
    setSnap,
    openPicker,
    closeSearch,
    pickResult: (t, r) => void onPick(t, r),
    pickOnMap: (t) => {
      setPicking(t);
      setSnap("rest");
    },
    trip,
    setTrip,
    arrived,
    clearArrived,
    parkingView: { state: parking, results: parkingResults, near },
    parked,
    setParked,
    startTrip,
    endTrip,
    planTo,
    searchFor,
    searchIntent,
    homeTiming,
    setHomeTiming,
    mapTheme,
    toast,
    layout,
    community,
    report,
    reportPin,
    flyTo,
    openReport,
  };

  const confirmPick = async () => {
    const c = center.current;
    const target = picking;
    setPicking(null);
    if (!c || !target) return;
    if (c[0] < -85.65 || c[0] > -80.8 || c[1] < 30.33 || c[1] > 35.03) {
      toast("That point is outside Georgia.");
      return;
    }
    const label = await reverseLabel(c);
    const place: JourneyPlace = { label: label ? `Near ${label}` : "Point on the map", lon: c[0], lat: c[1], source: "map" };
    if (target === "origin") journey.setOrigin(place);
    else {
      setIntentFor(null);
      journey.startSearch(place, { timing: takeHomeTiming() });
      void ensureOrigin();
    }
    go({ kind: "plan" }, "half");
  };

  useReminders(app);
  useEffect(() => {
    const on = (e: Event) => setToastText((e as CustomEvent<string>).detail);
    window.addEventListener("cm-reminder", on);
    return () => window.removeEventListener("cm-reminder", on);
  }, [setToastText]);

  // A shared trip link (?to=…) is applied once, then removed from the address bar so a reload
  // or a bookmark does not replay it. Without a start in the link, the current location is used
  // when it is already shared, so it waits briefly for the permission state.
  const handledIncoming = useRef(false);
  const applyIncoming = () => {
    const t = incoming?.trip;
    if (handledIncoming.current || !t) return;
    handledIncoming.current = true;
    if (t.destination.campus && t.destination.campus !== campus) setCampus(t.destination.campus);
    journey.startSearch(t.destination, { origin: t.origin ?? undefined, timing: t.timing });
    if (!t.origin) void ensureOrigin();
    go({ kind: "plan" }, "half", true);
    if (t.timingDropped) toast("The time in this link has passed, so the trip opens as Leave now.");
  };
  const applyIncomingRef = useRef(applyIncoming);
  useEffect(() => {
    applyIncomingRef.current = applyIncoming;
  });
  useEffect(() => {
    if (!incoming?.trip) return;
    const known = !!incoming.trip.origin || locationPermission !== "unknown";
    const t = setTimeout(() => applyIncomingRef.current(), known ? 0 : 700);
    return () => clearTimeout(t);
  }, [incoming, locationPermission]);
  // An app shortcut or older link (?view=…) opens its page.
  useEffect(() => {
    if (incoming?.view) router.replace(SHORTCUT_PATH[incoming.view]);
  }, [incoming, router]);

  // Keyboard: "/" opens search from anywhere that is not a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || viewKind === "search") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      openPicker("destination");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewKind, openPicker]);

  // What the map shows for each view.
  const selected = journey.selected;
  const planViews = view.kind === "plan" || view.kind === "detail" || view.kind === "home";
  // ArriveBy on the map: the plan's route (and the backup's, unselected), the entrance, and the parking it checked.
  const arrivePlan = view.kind === "arrive" ? arrive.plan : null;
  const arrivePrimary = arrivePlan?.primary ? arrive.option(arrivePlan.primary.optionId) : null;
  const arriveBackup = arrivePlan?.backup && "optionId" in arrivePlan.backup ? arrive.option(arrivePlan.backup.optionId) : null;
  const arriveEntrance = arrivePlan?.destination.entrance ?? null;
  const mapRoutes = useMemo(() => {
    if (view.kind === "trip" && trip) return [{ option: trip.option, selected: true }];
    if (view.kind === "plan" && journey.result) return journey.options.map((o) => ({ option: o, selected: o.id === selected?.id }));
    if ((view.kind === "detail" || view.kind === "home") && selected) return [{ option: selected, selected: true }];
    if (view.kind === "nearby" && walk.legs) return [{ option: { id: "walk-to-station", legs: walk.legs }, selected: true }];
    if (view.kind === "arrive" && arrivePrimary) return [...(arriveBackup && arriveBackup.id !== arrivePrimary.id ? [{ option: arriveBackup, selected: false }] : []), { option: arrivePrimary, selected: true }];
    return [];
  }, [view.kind, trip, journey.result, journey.options, selected, walk.legs, arrivePrimary, arriveBackup]);
  const mapStops: MapStop[] = useMemo(() => {
    const o = view.kind === "trip" ? trip?.option : view.kind === "plan" || view.kind === "detail" || view.kind === "stop" ? selected : view.kind === "arrive" ? arrivePrimary : null;
    if (!o) return [];
    const out: MapStop[] = [];
    o.legs.forEach((l) => {
      if (l.kind !== "ride" || !l.fromStop || !l.toStop) return;
      const color = l.route?.color && l.route.color !== "#000000" ? l.route.color : "";
      out.push({ ...l.fromStop, color, role: out.length ? "transfer" : "board" });
      out.push({ ...l.toStop, color, role: "alight" });
    });
    return out;
  }, [view.kind, trip, selected, arrivePrimary]);
  const mapStations: MapStation[] = useMemo(() => {
    if (view.kind === "nearby") return stationsList.filter((s) => nearbyFilter === "all" || s.kind === nearbyFilter).slice(0, 12).map((s) => ({ id: s.id, name: s.name, lon: s.lon, lat: s.lat, kind: s.kind, selected: s.id === nearbySelected }));
    if (view.kind === "home" && !selected) return stationsList.slice(0, 4).map((s) => ({ id: s.id, name: s.name, lon: s.lon, lat: s.lat, kind: s.kind, selected: false }));
    return [];
  }, [view.kind, stationsList, nearbyFilter, nearbySelected, selected]);
  const mapReports: MapReport[] = useMemo(() => {
    const list = community.reports;
    if (!list) return [];
    const show = view.kind === "community" ? list : view.kind === "home" || view.kind === "report" ? list.filter((r) => reportStatus(r) === "open") : [];
    const selectedId = view.kind === "community" ? (view.reportId ?? null) : view.kind === "report" ? (report.saved?.id ?? null) : null;
    return show.map((r) => ({ id: r.id, lon: r.lon, lat: r.lat, status: reportStatus(r) === "open" ? "open" : "fixed", confirmed: verificationLevel(r) === "community-confirmed", selected: r.id === selectedId }));
  }, [community.reports, view, report.saved]);
  const focusReport = view.kind === "community" && view.reportId ? (community.reports?.find((r) => r.id === view.reportId) ?? null) : null;
  const arriveParking = useMemo(() => {
    const places = arrivePlan?.parking?.places;
    if (!places || !arriveBuilding) return null;
    // The map colours places by status only; the plan's verdicts map onto the same four.
    const results = new Map(places.map((p) => [p.placeId, { placeId: p.placeId, status: arriveParkingStatus(p) } as ParkingResult]));
    return { results, selectedId: arrivePlan?.parking?.primary?.placeId ?? null, visibleIds: new Set(places.map((p) => p.placeId)) };
  }, [arrivePlan, arriveBuilding]);
  const parkingLayer = parkingActive
    ? { results: parkingResults, selectedId: view.kind === "parking" ? (view.placeId ?? null) : null, visibleIds: new Set(visibleParking(bundle, parkingResults, near).map((p) => p.id)) }
    : arriveParking;
  const coverBucket = Math.round(cover.bottom / 80);
  const arriveKey = view.kind === "arrive" ? `${arriveDest ? `${arriveDest.lon},${arriveDest.lat}` : ""}|${arrivePrimary?.id ?? ""}|${arrive.result?.generatedAt ?? ""}` : "";
  const frameKey = `${focusReport ? `r:${focusReport.id}|` : ""}${arriveKey}|${view.kind}|${campus ?? ""}|${dest ? `${dest.lon},${dest.lat}` : ""}|${planViews ? (selected?.id ?? "") : ""}|${journey.resultKey ?? "-"}|${parkingActive && parking.data ? "pk" : ""}|${trip?.option.id ?? ""}|${view.kind === "trip" ? (trip?.leg ?? 0) : ""}|${view.kind === "nearby" ? `${anchor?.lon},${anchor?.lat}|${nearbySelected ?? ""}|${stationsList.length}` : ""}|${coverBucket}`;
  const drawKey = `${view.kind === "arrive" ? `a:${arrive.result?.generatedAt ?? ""}:${arrivePrimary?.id ?? ""}:${arriveBackup?.id ?? ""}|` : ""}${journey.resultKey ?? ""}|${selected?.id ?? ""}|${view.kind === "trip" ? (trip?.option.id ?? "") : ""}|${view.kind === "nearby" ? (nearbySelected ?? "") : ""}`;

  // On a phone, pages (Account, Services, Activity…) cover the map; map screens are a sheet over it.
  // On a desktop every screen sits in the side panel and the map stays in view.
  const isPage = PAGE_KINDS.has(view.kind);
  const showPage = !desktop && isPage && !picking;
  const showSheet = !desktop && !isPage;
  const showDock = !desktop && TAB_ROOTS.has(view.kind) && !picking;
  const showExploreBar = !desktop && view.kind === "home" && !picking;
  // The browser's top bar takes the colour of the screen.
  const topColor = theme === "dark" ? "#07111F" : "#F5F8FC";
  useEffect(() => {
    const metas = Array.from(document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'));
    const before = metas.map((m) => m.content);
    metas.forEach((m) => (m.content = topColor));
    return () => metas.forEach((m, i) => (m.content = before[i]!));
  }, [topColor]);
  // The floating "Where to?" belongs to map screens on a phone; pages and forms go without it.
  const showSearch = !desktop && !picking && MAP_SEARCH_VIEWS.has(view.kind);
  const searchH = showSearch || showExploreBar ? 10 + 52 + 10 : 12;
  const insets = desktop ? { top: 12, bottom: 0, left: panelLeft, right: 0 } : { top: searchH, bottom: cover.bottom, left: 0, right: 0 };
  const footer =
    view.kind === "plan" ? <PlanFooter app={app} /> : view.kind === "detail" ? <DetailFooter app={app} /> : view.kind === "arrive" ? <ArriveFooter app={app} /> : view.kind === "report" ? <ReportFooter app={app} /> : view.kind === "community" ? <CommunityFooter app={app} /> : null;

  return (
    <RiderProvider value={app}>
        <div className="cm-app absolute inset-0 overflow-hidden bg-app-bg" data-theme={prefs.appearance} data-layout={layout}>
          <h1 className="sr-only">CrossMetric</h1>
          {/* Under a page the map stays loaded but is hidden from touch and assistive tech. */}
          <div className="absolute inset-0" inert={showPage} aria-hidden={showPage || undefined}>
            <CommuteMap
              bundle={bundle}
              theme={mapTheme}
              insets={insets}
              destination={
                view.kind === "arrive"
                  ? arriveDest
                    ? { point: arriveEntrance ? [arriveEntrance.lon, arriveEntrance.lat] : arriveBuilding?.entrances[0] ? [arriveBuilding.entrances[0].lon, arriveBuilding.entrances[0].lat] : [arriveDest.lon, arriveDest.lat], label: arriveDest.label, building: arriveBuilding }
                    : null
                  : dest && view.kind !== "nearby" && view.kind !== "saved" && view.kind !== "profile" && view.kind !== "prefs" && view.kind !== "report" && view.kind !== "community"
                    ? { point: destBuilding?.entrances[0] ? [destBuilding.entrances[0].lon, destBuilding.entrances[0].lat] : [dest.lon, dest.lat], label: dest.label, building: destBuilding }
                    : null
              }
              origin={view.kind === "nearby" ? (anchor && anchor.source !== "current" ? [anchor.lon, anchor.lat] : null) : journey.origin && journey.origin.source !== "current" && (planViews || view.kind === "trip" || view.kind === "arrive") ? [journey.origin.lon, journey.origin.lat] : null}
              userLocation={userLocation}
              routes={mapRoutes}
              parking={parkingLayer}
              parkedCar={parked && parked.campus === campus ? [parked.lon, parked.lat] : null}
              stops={mapStops}
              stations={mapStations}
              frameKey={frameKey}
              drawKey={drawKey}
              reducedMotion={reducedMotion}
              focusLeg={view.kind === "trip" && trip ? trip.leg : null}
              framePoints={focusReport ? [[focusReport.lon, focusReport.lat]] : (view.kind === "parked" || view.kind === "return") && parked && parked.campus === campus ? [[parked.lon, parked.lat]] : undefined}
              picking={!!picking || reportPicking}
              reports={mapReports}
              onSelectReport={(id) => go({ kind: "community", reportId: id }, "half", view.kind === "community")}
              flyTo={flyReq}
              onToggleStyle={() => setPrefs((p) => ({ ...p, mapStyle: mapTheme === "dark" ? "light" : "dark" }))}
              onCenter={(c) => {
                center.current = c;
                if (view.kind === "report") setMapCenter(c);
              }}
              onLocate={() => void locate()}
              locating={locating}
              onSelectRoute={(id) => {
                journey.select(id);
                if (view.kind !== "plan") go({ kind: "plan" }, "half");
              }}
              onSelectParking={(id) => {
                // On ArriveBy a tapped place becomes the plan's place when it can be used; otherwise say why not.
                if (view.kind === "arrive") {
                  const p = arrive.plan?.parking?.places.find((x) => x.placeId === id);
                  if (p && (p.verdict === "eligible" || p.verdict === "backup" || p.verdict === "recommended")) arrive.choosePlace(id);
                  else if (p) toast(`${p.name}: ${p.reason}`);
                  return;
                }
                go({ kind: "parking", placeId: id }, snap === "rest" ? "half" : snap);
              }}
              onSelectStop={(s) => go({ kind: "stop", stop: { id: s.id, name: s.name, lon: s.lon, lat: s.lat } })}
              onSelectStation={(id) => {
                setNearbySelected(id);
                if (view.kind !== "nearby") go({ kind: "nearby", stationId: id }, "half");
              }}
              onSelectBuilding={(id) => {
                if (view.kind === "trip" || !bundle) return;
                const b = buildings.get(id);
                if (!b) return;
                const e = b.entrances[0];
                if (view.kind === "arrive") {
                  arrive.setDestination({ label: b.name, lon: e?.lon ?? b.center[0], lat: e?.lat ?? b.center[1], source: "building", campus, buildingId: b.id });
                  return;
                }
                planTo({ label: b.name, lon: e?.lon ?? b.center[0], lat: e?.lat ?? b.center[1], source: "building", campus, buildingId: b.id });
              }}
            />
          </div>

          {/* Explore on a phone: the mark, the search and Account over the map. */}
          {showExploreBar ? (
            <div className="pointer-events-none absolute inset-x-0 top-0 z-30 px-3" style={{ paddingTop: "calc(env(safe-area-inset-top) + 10px)" }}>
              <div className="pointer-events-auto mx-auto flex max-w-[640px] items-center gap-2">
                <button
                  type="button"
                  onClick={() => openPicker("destination")}
                  aria-label="Search: where to explore or check?"
                  className="cm-glass cm-press flex h-[52px] min-w-0 flex-1 items-center gap-3 rounded-surface border border-app-line pl-2 pr-3 text-left"
                >
                  <LogoTile size={36} />
                  <span className="min-w-0 flex-1 truncate text-body text-app-muted">Where to explore or check?</span>
                </button>
                <button type="button" onClick={() => go({ kind: "profile" }, "full")} aria-label="Account and settings" className="cm-glass cm-press grid h-[52px] w-[52px] shrink-0 place-items-center rounded-surface border border-app-line text-app-ink">
                  <UserRound className="h-5 w-5" aria-hidden />
                </button>
              </div>
            </div>
          ) : null}

          {/* Other map screens on a phone: floating destination search. */}
          {showSearch ? (
            <div className="pointer-events-none absolute inset-x-0 top-0 z-30 px-3" style={{ paddingTop: "calc(env(safe-area-inset-top) + 10px)" }}>
              <div className="pointer-events-auto flex items-center gap-2">
                <div className="cm-glass flex h-[52px] min-w-0 flex-1 items-center gap-1 rounded-surface border border-app-line pl-1 pr-2">
                  <button
                    type="button"
                    onClick={() => openPicker("destination")}
                    className="cm-press flex h-full min-w-0 flex-1 items-center gap-3 rounded-ctl pl-3 text-left"
                    aria-label={dest ? `Destination: ${dest.label}. Search for another place` : "Search: where to explore or check?"}
                  >
                    {dest ? <MapPin className="h-5 w-5 shrink-0 text-app-ink" aria-hidden /> : <Search className="h-5 w-5 shrink-0 text-app-ink" strokeWidth={2.2} aria-hidden />}
                    <span className={`truncate text-body ${dest ? "font-medium text-app-ink" : "text-app-muted"}`}>{dest ? dest.label : "Where to explore or check?"}</span>
                  </button>
                  {dest ? (
                    <button type="button" onClick={() => journey.clear()} aria-label="Clear destination" className="cm-press cm-reveal grid h-9 w-9 shrink-0 place-items-center rounded-chip bg-app-chip hover:bg-app-chip-hover">
                      <X className="h-5 w-5" aria-hidden />
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {view.kind === "trip" && trip ? (
            <div className="pointer-events-none absolute right-0 top-0 z-30 flex justify-start px-4" style={{ left: panelLeft, paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}>
              <button type="button" onClick={() => go({ kind: "safety" }, "full")} className="cm-glass cm-press pointer-events-auto inline-flex h-11 items-center gap-2 rounded-ctl border border-app-line pl-2 pr-3.5 text-small font-semibold">
                <span className="grid h-7 w-7 place-items-center rounded-chip bg-app-accent text-app-on-accent" aria-hidden>
                  <ShieldCheck className="h-[18px] w-[18px]" />
                </span>
                Safety
              </button>
            </div>
          ) : null}

          {picking ? (
            <div className="absolute right-0 top-0 z-30 px-4" style={{ left: panelLeft, paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}>
              <div className="cm-glass cm-rise-in flex items-center gap-2 rounded-surface border border-app-line p-2 pl-4" role="dialog" aria-label="Choose on map">
                <MapPinned className="h-5 w-5 shrink-0 text-app-route" aria-hidden />
                <p className="min-w-0 flex-1 text-body">Move the map so the pin marks your {picking === "origin" ? "start" : "destination"}.</p>
                <button type="button" onClick={() => setPicking(null)} className="min-h-[44px] rounded-ctl px-3 text-body font-medium text-app-muted hover:bg-app-chip">
                  Cancel
                </button>
                <button type="button" onClick={() => void confirmPick()} className="min-h-[44px] rounded-ctl bg-app-primary px-4 text-body font-semibold text-app-on-primary">
                  Set {picking === "origin" ? "start" : "here"}
                </button>
              </div>
            </div>
          ) : null}

          <div role="status" aria-live="assertive" className="pointer-events-none absolute right-0 z-40 flex justify-center px-4" style={{ left: panelLeft, top: desktop ? 24 : 88 }}>
            {toastMsg ? (
              <div key={toastMsg.id} className="cm-toast pointer-events-auto relative flex max-w-[480px] items-center gap-3 overflow-hidden rounded-surface bg-app-strong py-3 pl-4 pr-2 text-body font-medium text-app-on-strong shadow-[var(--app-shadow-float)]">
                <Bell className="h-5 w-5 shrink-0" aria-hidden />
                <span className="min-w-0">{toastText}</span>
                <button type="button" onClick={() => setToastText(null)} aria-label="Dismiss" className="grid h-9 w-9 shrink-0 place-items-center rounded-full hover:bg-white/10">
                  <X className="h-4 w-4" aria-hidden />
                </button>
                <span aria-hidden className="cm-toast-timer absolute inset-x-0 bottom-0 h-[3px] bg-current opacity-25" style={{ animationDuration: `${TOAST_MS}ms` }} />
              </div>
            ) : null}
          </div>

          {!online ? (
            <div className="pointer-events-none absolute right-0 z-30 flex justify-center px-4" style={{ left: panelLeft, top: desktop ? 16 : 76 }}>
              <p className="rounded-ctl bg-app-strong px-3 py-1.5 text-small font-medium text-app-on-strong shadow-[var(--app-shadow)]">Offline · saved places and settings still work</p>
            </div>
          ) : null}

          {desktop ? <NavRail tab={tab} onTab={onTab} /> : null}
          <main id="main" className="contents">
            {desktop ? (
              <SidePanel label={`${PANEL_LABEL[view.kind] ?? "CrossMetric"} panel`} footer={picking ? null : footer} contentKey={view.kind} bare={isPage}>
                <div key={pathname} className="cm-screen flex flex-1 flex-col" data-dir={screen.dir}>
                  {children}
                </div>
              </SidePanel>
            ) : null}
            {showPage ? (
              <div key={pathname} className="cm-page absolute inset-0 z-20 overflow-y-auto overscroll-contain bg-app-bg" style={{ paddingBottom: view.kind === "arrived" ? 0 : "calc(24px + env(safe-area-inset-bottom))" }}>
                <div className="cm-screen mx-auto flex min-h-full w-full max-w-[600px] flex-col" data-dir={screen.dir}>
                  {children}
                </div>
              </div>
            ) : null}
            {showSheet ? (
              <BottomSheet
                snap={snap}
                onSnap={setSnap}
                label={`${PANEL_LABEL[view.kind] ?? view.kind} panel`}
                onCover={setCover}
                footer={picking ? null : footer}
                contentKey={view.kind}
                offset={showDock ? TABBAR_H : 0}
                restMax={view.kind === "home" ? 0.4 : undefined}
                halfShare={view.kind === "plan" ? 0.58 : undefined}
              >
                <div key={pathname} className="cm-screen" data-dir={screen.dir}>
                  {children}
                </div>
              </BottomSheet>
            ) : null}
          </main>

          {showDock ? <TabBar tab={tab} onTab={onTab} /> : null}
        </div>
    </RiderProvider>
  );
}
