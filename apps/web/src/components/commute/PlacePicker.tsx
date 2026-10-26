"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Bookmark, Building2, Clock3, GraduationCap, Home, LocateFixed, Loader2, MapPin, MapPinned, MapPinPlus, Search, Sparkles, TrainFront, TriangleAlert, X } from "lucide-react";
import { expandPlaceAlias, parseTripIntent, type TripIntent } from "@crossmetric/engine/commute";
import { useRecentSearches, useSavedPlaces } from "@/lib/commute-store";
import { REPORT_CATEGORIES, reportStatus, type ReportCategory } from "@/lib/reports";
import type { JourneyPlace, PlaceSource } from "@/lib/journey-types";
import { when } from "./format";
import type { AppModel, PickTarget } from "./model";
import { searchBuildings } from "./search";

interface Hit {
  label: string;
  sublabel?: string;
  lon: number;
  lat: number;
  kind?: string;
}

export interface PickResult {
  place: JourneyPlace | null;
  intent: TripIntent | null;
  /** The person chose to set the place by moving the map. */
  map?: boolean;
  /** ArriveBy: an arrival time that came with the pick (a class row says its time before it is chosen). */
  arriveBy?: number;
}

const TITLE: Record<PickTarget, string> = {
  destination: "Where to?",
  origin: "Where from?",
  nearby: "Transit near…",
  save: "Save a place",
  start: "Your usual start",
  arrive: "Arrive where?",
  report: "Where is the barrier?",
};

const PLACEHOLDER: Record<PickTarget, string> = {
  destination: "Where to explore or check?",
  origin: "Where are you starting?",
  nearby: "Search near an address or place",
  save: "Address or place to save",
  start: "Your usual start (e.g. home)",
  arrive: "Building name or short name (e.g. CULC)",
  report: "Address, intersection or place",
};

/** Words people type for each kind of barrier. */
const REPORT_WORDS: Partial<Record<ReportCategory, string[]>> = {
  curb_ramp: ["curb", "ramp", "kerb"],
  blocked_path: ["blocked", "obstruct", "sidewalk block"],
  difficult_crossing: ["crossing", "crosswalk", "signal"],
  damaged_sidewalk: ["broken sidewalk", "damaged", "cracked", "uneven"],
  missing_sidewalk: ["no sidewalk", "missing sidewalk"],
  construction: ["construction", "work zone"],
};

type RowItem = { id: string; icon: React.ReactNode; title: string; sub?: string; pick: () => void | Promise<void> };

/**
 * Search for a destination, a start, a place to look near, or a place to save.
 * Typed requests are read with deterministic rules and shown back before
 * anything is planned. Address search goes through CrossMetric's server to an
 * OpenStreetMap geocoder limited to Georgia.
 */
export function PlacePicker({ app, target, onClose, onPick }: { app: AppModel; target: PickTarget; onClose: () => void; onPick: (r: PickResult) => void }) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [hits, setHits] = useState<Hit[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "unavailable">("idle");
  const [locBusy, setLocBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [places] = useSavedPlaces();
  const [recents] = useRecentSearches();

  const intent = useMemo(() => (target === "destination" && q.trim() ? parseTripIntent(q) : null), [q, target]);
  const region = app.campus === "uga" ? "athens" : app.campus === "gt" ? "atlanta" : null;
  const placeQuery = useMemo(() => {
    const text = intent ? intent.place : q.trim();
    return text ? expandPlaceAlias(text, region) : "";
  }, [intent, q, region]);
  // Coarse bias (about 10 km) toward where the person is planning: the start, their location, or the campus.
  const biasPoint = app.journey.origin ?? (app.userLocation ? { lon: app.userLocation[0], lat: app.userLocation[1] } : app.bundle ? { lon: app.bundle.center[0], lat: app.bundle.center[1] } : null);
  const bias = biasPoint ? `${biasPoint.lon.toFixed(1)},${biasPoint.lat.toFixed(1)}` : null;
  const buildings = useMemo(() => (placeQuery && app.bundle ? searchBuildings(placeQuery, app.bundle.buildings, target === "arrive" ? 6 : 4) : []), [placeQuery, app.bundle, target]);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (placeQuery.length < 3) return;
    const c = new AbortController();
    const t = setTimeout(() => {
      setStatus("loading");
      fetch(`/api/places?q=${encodeURIComponent(placeQuery)}${bias ? `&near=${bias}` : ""}`, { signal: c.signal })
        .then((r) => r.json() as Promise<{ results: Hit[]; geocoder?: string }>)
        .then((r) => {
          setHits(r.results.slice(0, 6));
          setStatus(r.geocoder === "unavailable" ? "unavailable" : "idle");
        })
        .catch((e: Error) => e.name !== "AbortError" && setStatus("error"));
    }, 250);
    return () => {
      clearTimeout(t);
      c.abort();
    };
  }, [placeQuery, bias]);

  const done = (place: JourneyPlace | null, i: TripIntent | null = intent) => onPick({ place, intent: i });
  const asPlace = (h: Hit, source: PlaceSource): JourneyPlace => ({ label: h.label, sublabel: h.sublabel ?? null, lon: h.lon, lat: h.lat, source });

  const rows: { section: string; items: RowItem[] }[] = [];
  const query = q.trim();

  // Accessibility concerns: words like "curb ramp", "sidewalk" or "report" find the community's reports
  // of that kind (and the way to add one), next to the places.
  if (target === "destination" && query.length >= 3) {
    const words = query.toLowerCase();
    const kinds = REPORT_CATEGORIES.filter((c) => (REPORT_WORDS[c.id] ?? []).some((w) => words.includes(w)) || c.label.toLowerCase().includes(words));
    const list = app.community.reports;
    const items: RowItem[] = kinds.slice(0, 3).map((c) => {
      const open = list ? list.filter((r) => r.category === c.id && reportStatus(r) === "open").length : null;
      return { id: `rep-${c.id}`, icon: <TriangleAlert className="h-5 w-5" />, title: c.label, sub: open === null ? "Community reports" : `${open} open ${open === 1 ? "report" : "reports"} on the Community map`, pick: () => app.go({ kind: "community" }, "half", true) };
    });
    if (items.length || /\b(report|barrier|wheelchair|ada)\b|accessib/.test(words)) {
      items.push({ id: "rep-new", icon: <MapPinPlus className="h-5 w-5" />, title: "Report a barrier", sub: "Pin a blocked sidewalk, curb ramp or crossing", pick: () => app.openReport() });
      rows.push({ section: "Accessibility", items });
    }
  }

  // Typed requests that are not a destination search.
  if (intent?.action === "nearby_transit") {
    rows.push({
      section: "Your request",
      items: [{ id: "intent-nearby", icon: <TrainFront className="h-5 w-5" />, title: intent.railOnly ? "Nearest rail stations" : "Transit near you", sub: intent.place ? `Near ${intent.place}` : "Near your start or current location", pick: () => done(null) }],
    });
  } else if (intent?.action === "parking") {
    rows.push({ section: "Your request", items: [{ id: "intent-parking", icon: <MapPinned className="h-5 w-5" />, title: "Parking", sub: intent.place ? `Near ${intent.place}` : "Near your destination", pick: () => done(null) }] });
  }

  if (!query) {
    const quick: RowItem[] = [];
    if (target === "origin" || target === "nearby" || target === "start" || target === "report") {
      quick.push({
        id: "current",
        icon: locBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <LocateFixed className="h-5 w-5" />,
        title: "Current location",
        sub: app.locationPermission === "denied" ? "Location is blocked in this browser's settings" : app.locationPermission === "granted" ? "Shared with this site" : "Asks to use your location once",
        pick: async () => {
          setLocBusy(true);
          const p = await app.currentPlace();
          setLocBusy(false);
          if (p) done(p, null);
        },
      });
      if (app.prefs.origin) quick.push({ id: "saved-start", icon: <Home className="h-5 w-5" />, title: app.prefs.origin.label, sub: "Saved start", pick: () => done({ ...app.prefs.origin!, source: "saved" }, null) });
    }
    for (const p of places) quick.push({ id: `place-${p.id}`, icon: p.kind === "home" ? <Home className="h-5 w-5" /> : <Bookmark className="h-5 w-5" />, title: p.name, sub: p.place.label !== p.name ? p.place.label : p.place.sublabel ?? undefined, pick: () => done({ ...p.place, source: "saved" }, null) });
    if (quick.length) rows.push({ section: target === "destination" ? "Saved places" : "Quick picks", items: quick });

    if (target === "destination" || target === "arrive") {
      const seen = new Set<string>();
      const classes = app.occurrences
        .filter((o) => o.start > app.now && o.buildingId && !o.remote && o.status !== "cancelled" && app.buildings.has(o.buildingId))
        .filter((o) => (seen.has(o.buildingId!) ? false : (seen.add(o.buildingId!), true)))
        .slice(0, 3);
      if (classes.length) {
        rows.push({
          section: "Your classes",
          items: classes.map((o) => {
            const b = app.buildings.get(o.buildingId!)!;
            const e = b.entrances[0];
            const place: JourneyPlace = { label: b.name, lon: e?.lon ?? b.center[0], lat: e?.lat ?? b.center[1], source: "building", campus: app.campus, buildingId: b.id };
            // ArriveBy: the row says the arrival time it sets (your entry buffer before the class), so nothing is set silently.
            const by = o.start - app.prefs.entryBufferMin * 60_000;
            if (target === "arrive") return { id: `class-${o.key}`, icon: <GraduationCap className="h-5 w-5" />, title: b.name, sub: `${o.title ? `${o.title} · ` : ""}arrive by ${when(by, app.now)}`, pick: () => onPick({ place, intent: null, arriveBy: by > app.now ? by : undefined }) };
            return { id: `class-${o.key}`, icon: <GraduationCap className="h-5 w-5" />, title: b.name, sub: `${o.title ? `${o.title} · ` : ""}${when(o.start, app.now)}`, pick: () => done(place, null) };
          }),
        });
      }
    }
    if (target !== "save" && app.prefs.keepHistory) {
      const recent = recents
        .map((r) => (target === "origin" ? ("current" in r.from ? null : r.from) : r.to))
        .filter((p): p is JourneyPlace => !!p)
        .filter((p, i, list) => list.findIndex((x) => x.label === p.label && Math.abs(x.lon - p.lon) < 1e-5) === i)
        .slice(0, 4);
      if (recent.length) rows.push({ section: "Recent", items: recent.map((p, i) => ({ id: `recent-${i}`, icon: <Clock3 className="h-5 w-5" />, title: p.label, sub: p.sublabel ?? undefined, pick: () => done(p, null) })) });
    }
  } else if (!intent || intent.action === "route" || (intent.place && intent.action !== "nearby_transit") || target !== "destination") {
    if (buildings.length) {
      rows.push({
        section: `${app.bundle?.shortName ?? "Campus"} buildings`,
        items: buildings.map((b) => {
          const e = b.entrances[0];
          return { id: `b-${b.id}`, icon: <Building2 className="h-5 w-5" />, title: b.name, sub: b.aliases.slice(0, 2).join(" · ") || app.bundle?.name, pick: () => done({ label: b.name, lon: e?.lon ?? b.center[0], lat: e?.lat ?? b.center[1], source: "building", campus: app.campus, buildingId: b.id }) };
        }),
      });
    }
    if (placeQuery.length >= 3 && hits.length) {
      rows.push({ section: "Places in Georgia", items: hits.map((h, i) => ({ id: `h-${i}`, title: h.label, sub: h.sublabel, icon: h.kind === "station" ? <TrainFront className="h-5 w-5" /> : <MapPin className="h-5 w-5" />, pick: () => done(asPlace(h, (h.kind as PlaceSource) ?? "place")) })) });
    }
  }
  // ArriveBy picks a building; on its map you tap the building itself.
  if (target !== "save" && target !== "arrive") {
    rows.push({ section: "", items: [{ id: "map", icon: <MapPinned className="h-5 w-5" />, title: "Choose on map", sub: "Move the map to the place", pick: () => onPick({ place: null, intent: null, map: true }) }] });
  }

  const flat = rows.flatMap((r) => r.items);
  const listId = "cm-picker-results";
  const showIntent = intent && intent.understood.length > 0;

  const title = TITLE[target];
  const from = app.journey.origin;
  // What a new search will start from: the chosen start, else the current location when shared, else the saved start.
  const startLabel = from ? (from.source === "current" ? "Current location" : from.label) : app.locationPermission === "granted" ? "Current location" : (app.prefs.origin?.label ?? "Choose a start");
  return (
    <div className="flex flex-1 flex-col" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <div className="sticky top-0 z-10 bg-app-bg px-4 pb-3 pt-2">
        <div className="flex items-center justify-between">
          <button type="button" onClick={onClose} aria-label="Close search" className="cm-press -ml-2 grid h-11 w-11 shrink-0 place-items-center rounded-full hover:bg-app-chip">
            <ArrowLeft className="h-6 w-6" aria-hidden />
          </button>
          <WhenHint app={app} target={target} />
        </div>
        <h2 className="t-page mt-1">{title}</h2>

        <div className="mt-4 rounded-surface bg-app-chip p-1 transition-shadow focus-within:shadow-[0_0_0_2px_var(--app-ink)]">
          {target === "destination" || target === "arrive" ? (
            <>
              <button type="button" onClick={() => app.openPicker("origin")} aria-label={`Start: ${startLabel}. Change start`} className="cm-press flex min-h-[48px] w-full items-center gap-3 rounded-ctl px-3 text-left hover:bg-app-chip-hover">
                <span className="grid h-5 w-5 shrink-0 place-items-center" aria-hidden>
                  <span className="h-3 w-3 rounded-full bg-app-ink" />
                </span>
                <span className="min-w-0 flex-1 truncate text-body font-medium">{startLabel}</span>
              </button>
              <div className="mx-3 h-px bg-app-line-strong/60" aria-hidden />
            </>
          ) : null}
          <div className="flex items-center gap-1 pr-1">
            <span className="grid h-5 w-5 shrink-0 translate-x-3 place-items-center" aria-hidden>
              {target === "destination" || target === "arrive" ? <span className="h-3 w-3 bg-app-ink" /> : <Search className="h-5 w-5" strokeWidth={2.5} />}
            </span>
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((a) => Math.min(a + 1, flat.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) => Math.max(a - 1, 0));
                } else if (e.key === "Enter" && flat[active]) {
                  e.preventDefault();
                  void flat[active]!.pick();
                }
              }}
              role="combobox"
              aria-expanded={flat.length > 0}
              aria-controls={listId}
              aria-activedescendant={flat[active] ? `opt-${flat[active]!.id}` : undefined}
              aria-autocomplete="list"
              aria-label={PLACEHOLDER[target]}
              placeholder={PLACEHOLDER[target]}
              className="h-[52px] min-w-0 flex-1 bg-transparent pl-6 pr-2 text-component font-medium outline-none placeholder:font-normal placeholder:text-app-muted focus-visible:!outline-none"
              autoComplete="off"
              enterKeyHint="search"
            />
            {q ? (
              <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="grid h-10 w-10 shrink-0 place-items-center rounded-full hover:bg-app-chip-hover">
                <X className="h-5 w-5" aria-hidden />
              </button>
            ) : null}
          </div>
        </div>
      </div>
      {showIntent ? (
        <div className="mx-4 mb-1 flex flex-wrap items-center gap-1.5 rounded-ctl bg-app-chip px-3 py-2 text-small" aria-live="polite">
          <Sparkles className="h-4 w-4 text-app-muted" aria-hidden />
          <span className="text-app-muted">Understood:</span>
          {intent!.understood.map((u) => (
            <span key={u} className="rounded-tag bg-app-surface px-2 py-0.5 font-medium text-app-ink">
              {u}
            </span>
          ))}
          {intent!.place ? <span className="text-app-muted">· to &ldquo;{intent!.place}&rdquo;</span> : null}
        </div>
      ) : null}
      <div className="flex-1 px-2 pb-6" id={listId} role="listbox" aria-label="Results">
        {rows.map((section, si) =>
          section.items.length ? (
            <div key={si} role="group" aria-label={section.section || "More"}>
              {section.section ? <p className="px-3 pb-1 pt-4 text-small font-medium text-app-muted">{section.section}</p> : <hr className="mx-3 my-2 border-app-line" />}
              {section.items.map((item) => {
                const i = flat.indexOf(item);
                return (
                  <button
                    key={item.id}
                    id={`opt-${item.id}`}
                    role="option"
                    aria-selected={i === active}
                    type="button"
                    onClick={() => void item.pick()}
                    onMouseEnter={() => setActive(i)}
                    className={`cm-press flex min-h-[60px] w-full items-center gap-3 rounded-ctl px-3 py-2 text-left ${i === active ? "bg-app-chip" : "hover:bg-app-chip"}`}
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center text-app-ink" aria-hidden>
                      {item.icon}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-body font-medium text-app-ink [overflow-wrap:anywhere]">
                        <Highlight text={item.title} query={placeQuery || query} />
                      </span>
                      {item.sub ? <span className="block truncate text-small text-app-muted">{item.sub}</span> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null,
        )}
        <div aria-live="polite" className="px-3 py-2 text-small text-app-muted">
          {placeQuery.length >= 3 && status === "loading" ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Looking up &ldquo;{placeQuery}&rdquo;…
            </span>
          ) : null}
          {status === "error" || status === "unavailable" ? <span>Address search is unavailable right now. Saved places, campus buildings and Choose on map still work.</span> : null}
          {placeQuery.length >= 3 && status === "idle" && !hits.length && !buildings.length ? <span>No matching place in Georgia. Try a street address or a city name.</span> : null}
          {query && placeQuery.length > 0 && placeQuery.length < 3 && !buildings.length ? <span>Keep typing…</span> : null}
        </div>
        {target === "arrive" && !app.bundle ? <p className="px-3 pt-2 text-small text-app-muted">Choose Georgia Tech or UGA in ArriveBy to search campus buildings by name.</p> : null}
        <p className="px-3 pt-2 text-meta text-app-muted">Searches go through CrossMetric&rsquo;s server to an OpenStreetMap geocoder. Nothing is stored there.</p>
      </div>
    </div>
  );
}

/** A reminder that this search is for a later time (set with the Now pill on Home). */
function WhenHint({ app, target }: { app: AppModel; target: PickTarget }) {
  if (target !== "destination" || app.homeTiming.mode === "now") return null;
  return <span className="rounded-chip bg-app-chip px-3 py-1.5 text-small font-medium">Later trip</span>;
}

/** The title with the typed words in bold, so the match is easy to spot. */
function Highlight({ text, query }: { text: string; query: string }) {
  const words = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 2);
  if (!words.length) return <>{text}</>;
  const lower = text.toLowerCase();
  const marks: [number, number][] = [];
  for (const w of words) {
    let i = lower.indexOf(w);
    while (i >= 0) {
      marks.push([i, i + w.length]);
      i = lower.indexOf(w, i + w.length);
    }
  }
  if (!marks.length) return <>{text}</>;
  marks.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const m of marks) {
    const last = merged[merged.length - 1];
    if (last && m[0] <= last[1]) last[1] = Math.max(last[1], m[1]);
    else merged.push([m[0], m[1]]);
  }
  const out: React.ReactNode[] = [];
  let at = 0;
  merged.forEach(([a, b], k) => {
    if (a > at) out.push(text.slice(at, a));
    out.push(
      <strong key={k} className="font-bold">
        {text.slice(a, b)}
      </strong>,
    );
    at = b;
  });
  if (at < text.length) out.push(text.slice(at));
  return <>{out}</>;
}
