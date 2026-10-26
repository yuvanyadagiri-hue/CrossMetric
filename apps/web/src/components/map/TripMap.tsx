"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GeoJSONSource, Map as MapLibreMap, MapLayerMouseEvent, Marker, Popup } from "maplibre-gl";
import { Layers, LocateFixed, Minus, Plus } from "lucide-react";
import type { CurbResult, LonLat, Place, TripResult } from "@/lib/trip-types";
import { formatDistance, formatDuration } from "@/lib/trip-types";
import { loadInstitutionRows } from "@/lib/institutions-client";
import { categoryLabel, type CommunityReport } from "@/lib/reports";
import { loadMapLibre } from "./loadMapLibre";
import { BASEMAP_STYLE } from "./mapTheme";
import { boundsOf, escapeHtml, markerElement, pointAlong, ROUTE_COLORS } from "./mapUtils";

export interface MapLayerState {
  conditions: boolean;
  hotspots: boolean;
  institutions: boolean;
  transit: boolean;
  reports: boolean;
}

const DEFAULT_LAYERS: MapLayerState = { conditions: true, hotspots: true, institutions: true, transit: false, reports: true };
const ATLANTA: LonLat = [-84.388, 33.765];
const ROLE_LABEL = { safest: "Safest route", balanced: "Balanced route", fastest: "Fastest route" } as const;

type Fc = { type: "FeatureCollection"; features: { type: "Feature"; properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } }[] };
const EMPTY: Fc = { type: "FeatureCollection", features: [] };

// Module-level caches so every map on a page shares one download.
let institutionsData: Promise<Fc> | null = null;
let transitData: Promise<Fc> | null = null;

function loadInstitutions(): Promise<Fc> {
  institutionsData ??= loadInstitutionRows().then((rows) => ({
    type: "FeatureCollection" as const,
    features: rows.map((r) => ({
      type: "Feature" as const,
      properties: { id: r.id, type: r.type, name: r.name, city: r.city ?? "", level: r.level ?? "" },
      geometry: { type: "Point", coordinates: [r.lon, r.lat] },
    })),
  }));
  institutionsData.catch(() => (institutionsData = null));
  return institutionsData;
}

function loadTransit(): Promise<Fc> {
  transitData ??= fetch("/api/map/transit")
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((t: { stops: { name: string[]; lon: number[]; lat: number[]; rail: boolean[]; routes: string[][] } }) => ({
      type: "FeatureCollection" as const,
      features: t.stops.name.map((name, i) => ({
        type: "Feature" as const,
        properties: { name, rail: t.stops.rail[i] ? 1 : 0, routes: (t.stops.routes[i] ?? []).join(", ") },
        geometry: { type: "Point", coordinates: [t.stops.lon[i], t.stops.lat[i]] },
      })),
    }));
  transitData.catch(() => (transitData = null));
  return transitData;
}

export interface TripMapProps {
  trip: TripResult | null;
  from: Place | null;
  to: Place | null;
  selectedRouteId: string | null;
  onSelectRoute?: (id: string) => void;
  loading?: boolean;
  curb?: CurbResult | null;
  /** Map padding (px) so routes are framed clear of overlapping panels. */
  padding?: { top: number; right: number; bottom: number; left: number };
  className?: string;
  layers?: Partial<MapLayerState>;
  showLegend?: boolean;
  /** Short label for screen readers describing what the map shows. */
  ariaLabel?: string;
}

export function TripMap({ trip, from, to, selectedRouteId, onSelectRoute, loading = false, curb = null, padding, className = "", layers: initialLayers, showLegend = true, ariaLabel }: TripMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const popupRef = useRef<Popup | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const mlRef = useRef<typeof import("maplibre-gl") | null>(null);
  const selectRef = useRef(onSelectRoute);
  const router = useRouter();
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [layers, setLayers] = useState<MapLayerState>({ ...DEFAULT_LAYERS, ...initialLayers });
  const [legendOpen, setLegendOpen] = useState(true);
  const [reports, setReports] = useState<CommunityReport[]>([]);
  // Keyed by value so a new padding object each render does not re-frame the map.
  const [pt, pr, pb, pl] = [padding?.top ?? 60, padding?.right ?? 60, padding?.bottom ?? 60, padding?.left ?? 60];
  const pad = useMemo(() => ({ top: pt, right: pr, bottom: pb, left: pl }), [pt, pr, pb, pl]);

  useEffect(() => {
    selectRef.current = onSelectRoute;
  }, [onSelectRoute]);

  // 1. Create the map once.
  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | null = null;
    (async () => {
      const maplibre = await loadMapLibre();
      if (cancelled || !containerRef.current) return;
      mlRef.current = maplibre;
      map = new maplibre.Map({
        container: containerRef.current,
        style: BASEMAP_STYLE,
        center: ATLANTA,
        zoom: 12.5,
        attributionControl: { compact: true },
      });
      mapRef.current = map;
      popupRef.current = new maplibre.Popup({ closeButton: false, closeOnClick: false, offset: 12, maxWidth: "260px" });
      map.on("error", (e) => {
        if (String(e.error?.message ?? "").toLowerCase().includes("style")) setFailed(true);
      });
      map.on("load", () => {
        if (!map) return;
        const firstLabel = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
        for (const id of ["cm-routes", "cm-selected", "cm-segments", "cm-institutions", "cm-transit", "cm-reports"]) map.addSource(id, { type: "geojson", data: EMPTY as never });

        map.addLayer({ id: "cm-routes-casing", type: "line", source: "cm-routes", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 11, 5, 16, 11] } }, firstLabel);
        map.addLayer(
          {
            id: "cm-routes",
            type: "line",
            source: "cm-routes",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": ROUTE_COLORS.alternative, "line-width": ["interpolate", ["linear"], ["zoom"], 11, 3, 16, 7], "line-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 1, 0.85] },
          },
          firstLabel,
        );
        map.addLayer({ id: "cm-selected-casing", type: "line", source: "cm-selected", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ROUTE_COLORS.selectedCasing, "line-width": ["interpolate", ["linear"], ["zoom"], 11, 8, 16, 15] } });
        map.addLayer({ id: "cm-selected", type: "line", source: "cm-selected", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ROUTE_COLORS.selected, "line-width": ["interpolate", ["linear"], ["zoom"], 11, 4.5, 16, 9] } });
        map.addLayer({
          id: "cm-segments",
          type: "line",
          source: "cm-segments",
          layout: { "line-cap": "round", "line-join": "round" },
          filter: ["!=", ["get", "level"], "lower"],
          paint: {
            "line-color": ["match", ["get", "level"], "elevated", ROUTE_COLORS.elevated, ROUTE_COLORS.moderate],
            "line-width": ["interpolate", ["linear"], ["zoom"], 11, 4.5, 16, 9],
          },
        });
        map.addLayer({
          id: "cm-transit",
          type: "circle",
          source: "cm-transit",
          minzoom: 12,
          paint: {
            "circle-radius": ["case", ["==", ["get", "rail"], 1], 5.5, 3.2],
            "circle-color": ["case", ["==", ["get", "rail"], 1], "#15191E", "#ffffff"],
            "circle-stroke-color": "#3E5C8A",
            "circle-stroke-width": ["case", ["==", ["get", "rail"], 1], 2.5, 1.6],
          },
        });
        map.addLayer({
          id: "cm-institutions",
          type: "circle",
          source: "cm-institutions",
          minzoom: 10,
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3, 15, 7],
            "circle-color": ["match", ["get", "type"], "college", "#3E5C8A", "#15191E"],
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 1.8,
          },
        });
        map.addLayer({
          id: "cm-reports",
          type: "circle",
          source: "cm-reports",
          paint: { "circle-radius": 6, "circle-color": "#f0a020", "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 },
        });

        const hoverPopup = (layer: string, html: (p: Record<string, unknown>) => string) => {
          map!.on("mousemove", layer, (e: MapLayerMouseEvent) => {
            const f = e.features?.[0];
            if (!f || !map) return;
            map.getCanvas().style.cursor = "pointer";
            popupRef.current?.setLngLat(e.lngLat).setHTML(html(f.properties as Record<string, unknown>)).addTo(map);
          });
          map!.on("mouseleave", layer, () => {
            if (!map) return;
            map.getCanvas().style.cursor = "";
            popupRef.current?.remove();
          });
        };
        const card = (title: string, sub: string) => `<div style="font:500 12px var(--font-sans);color:#15191E"><div style="font-weight:600">${escapeHtml(title)}</div><div style="color:#5b6b80;margin-top:2px">${escapeHtml(sub)}</div></div>`;
        hoverPopup("cm-institutions", (p) => card(String(p.name), `${p.type === "college" ? "College" : String(p.level || "School")}${p.city ? ` · ${p.city}` : ""} · click for profile`));
        hoverPopup("cm-transit", (p) => card(String(p.name), `MARTA ${p.rail ? "rail" : "bus"} · ${p.routes ? `Routes ${p.routes}` : ""}`));
        hoverPopup("cm-reports", (p) => card(String(p.title), `Community report (unverified) · ${p.when}`));
        hoverPopup("cm-segments", (p) => card(p.level === "elevated" ? "Higher concern along this stretch" : "Some concern along this stretch", String(p.reason)));
        map.on("click", "cm-institutions", (e: MapLayerMouseEvent) => {
          const id = (e.features?.[0]?.properties as { id?: string } | undefined)?.id;
          if (id) routerRef.current.push(`/schools/${id}`);
        });
        map.on("click", "cm-routes", (e: MapLayerMouseEvent) => {
          const id = (e.features?.[0]?.properties as { id?: string } | undefined)?.id;
          if (id) selectRef.current?.(id);
        });
        map.on("mouseenter", "cm-routes", () => map && (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", "cm-routes", () => map && (map.getCanvas().style.cursor = ""));
        setReady(true);
      });
    })().catch(() => setFailed(true));
    return () => {
      cancelled = true;
      popupRef.current?.remove();
      for (const m of markersRef.current) m.remove();
      markersRef.current = [];
      map?.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!ready || !el) return;
    const ro = new ResizeObserver(() => mapRef.current?.resize());
    ro.observe(el);
    return () => ro.disconnect();
  }, [ready]);

  // 2. Routes, selection and condition segments.
  const selected = trip?.routes.find((r) => r.id === selectedRouteId) ?? trip?.routes[0] ?? null;
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const others = (trip?.routes ?? []).filter((r) => r.id !== selected?.id);
    (map.getSource("cm-routes") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: others.map((r) => ({ type: "Feature", properties: { id: r.id }, geometry: { type: "LineString", coordinates: r.geometry } })),
    } as never);
    (map.getSource("cm-selected") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: selected ? [{ type: "Feature", properties: { id: selected.id }, geometry: { type: "LineString", coordinates: selected.geometry } }] : [],
    } as never);
    (map.getSource("cm-segments") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: selected && layers.conditions ? selected.segments.map((s) => ({ type: "Feature", properties: { level: s.level, reason: s.reason }, geometry: { type: "LineString", coordinates: s.coords } })) : [],
    } as never);
  }, [ready, trip, selected, layers.conditions]);

  // 3. Markers: start, destination, route callouts, crash clusters, curb points.
  useEffect(() => {
    const map = mapRef.current;
    const ml = mlRef.current;
    if (!ready || !map || !ml) return;
    for (const m of markersRef.current) m.remove();
    markersRef.current = [];
    const add = (el: HTMLElement, at: LonLat, anchor: "center" | "bottom" = "center") => {
      markersRef.current.push(new ml.Marker({ element: el, anchor }).setLngLat(at).addTo(map));
    };
    if (from) add(markerElement("origin", `Start: ${from.label}`), [from.lon, from.lat]);
    if (to) add(markerElement(to.kind === "school" || to.kind === "college" ? "institution" : "destination", `Destination: ${to.label}`), [to.lon, to.lat], "bottom");

    const routes = trip?.routes ?? [];
    routes.forEach((r, i) => {
      const at = pointAlong(r.geometry, [0.5, 0.22, 0.78, 0.36][i % 4]!);
      const el = document.createElement("button");
      el.type = "button";
      const isSel = r.id === selected?.id;
      const band = r.crossScore.band.id;
      const dot = band === "lower" ? "#12a46f" : band === "mixed" ? "#f0a020" : "#e5484d";
      el.className = "cm-marker";
      el.setAttribute("aria-label", `${ROLE_LABEL[r.roles[0]!]}: CrossScore ${r.crossScore.score}, ${formatDuration(r.durationS)}, ${formatDistance(r.lengthM)}`);
      el.style.cssText = `display:flex;align-items:center;gap:8px;padding:6px 10px 6px 8px;border-radius:10px;border:0;cursor:pointer;font-family:var(--font-sans);box-shadow:0 4px 14px rgba(21,25,30,.25);background:${isSel ? "#15191E" : "#ffffff"};color:${isSel ? "#fff" : "#15191E"}`;
      el.innerHTML = `<span style="font-size:20px;font-weight:650;letter-spacing:-.03em;font-variant-numeric:tabular-nums">${r.crossScore.score}</span><span style="display:flex;flex-direction:column;text-align:left;line-height:1.2"><span style="display:flex;align-items:center;gap:5px;font-size:12px;font-weight:600"><span style="width:7px;height:7px;border-radius:50%;background:${dot}"></span>${escapeHtml(r.roles.map((x) => ROLE_LABEL[x].replace(" route", "")).join(" · "))}</span><span style="font-size:11.5px;opacity:.75">${escapeHtml(`${formatDuration(r.durationS)} · ${formatDistance(r.lengthM)}`)}</span></span>`;
      el.addEventListener("click", () => selectRef.current?.(r.id));
      add(el, at);
    });

    if (selected && layers.hotspots) {
      for (const h of selected.hotspots) {
        const el = markerElement("hotspot", `Crash cluster: ${h.label}, ${h.crashes} crashes`);
        el.addEventListener("mouseenter", () => {
          popupRef.current
            ?.setLngLat([h.lon, h.lat])
            .setHTML(
              `<div style="font:500 12px var(--font-sans);color:#15191E"><div style="font-weight:600">${escapeHtml(h.label)}</div><div style="color:#5b6b80;margin-top:2px">${h.crashes} crashes reported within 30 m${h.injury ? ` · ${h.injury} with injuries` : ""}${h.pedestrian ? ` · ${h.pedestrian} pedestrian` : ""}${h.bicyclist ? ` · ${h.bicyclist} bicyclist` : ""}</div></div>`,
            )
            .addTo(map);
        });
        el.addEventListener("mouseleave", () => popupRef.current?.remove());
        add(el, [h.lon, h.lat]);
      }
    }
    if (curb) {
      curb.options.forEach((o, i) => {
        const best = o.id === curb.recommendedId;
        const el = markerElement(best ? "pickupBest" : "pickup", `${o.current ? "Current" : "Alternative"} ${curb.purpose === "pickup" ? "pickup" : "drop-off"} point on ${o.street}, score ${o.score.score}`, o.current ? "Now" : String(i));
        add(el, [o.lon, o.lat]);
      });
    }
  }, [ready, trip, selected, from, to, layers.hotspots, curb]);

  // 4. Frame the trip.
  const frameKey = trip ? trip.routes.map((r) => r.id + r.lengthM).join("|") + trip.from.lon + trip.to.lon : `${from?.lon ?? ""}${to?.lon ?? ""}`;
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const pts: LonLat[] = [...(trip?.routes.flatMap((r) => r.geometry) ?? []), ...(from ? [[from.lon, from.lat] as LonLat] : []), ...(to ? [[to.lon, to.lat] as LonLat] : [])];
    const b = boundsOf(pts);
    if (!b) return;
    if (pts.length === 1) map.easeTo({ center: pts[0], zoom: 14.5, duration: 600 });
    else map.fitBounds(b, { padding: pad, duration: 700, maxZoom: 16 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, frameKey, pad]);

  // 5. Optional layers.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.setLayoutProperty("cm-institutions", "visibility", layers.institutions ? "visible" : "none");
    if (layers.institutions) loadInstitutions().then((d) => (map.getSource("cm-institutions") as GeoJSONSource | undefined)?.setData(d as never)).catch(() => undefined);
  }, [ready, layers.institutions]);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.setLayoutProperty("cm-transit", "visibility", layers.transit ? "visible" : "none");
    if (layers.transit) loadTransit().then((d) => (map.getSource("cm-transit") as GeoJSONSource | undefined)?.setData(d as never)).catch(() => undefined);
  }, [ready, layers.transit]);
  useEffect(() => {
    if (!layers.reports) return;
    const controller = new AbortController();
    fetch("/api/reports", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((b: { reports: CommunityReport[] }) => setReports(b.reports))
      .catch(() => undefined);
    return () => controller.abort();
  }, [layers.reports]);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.setLayoutProperty("cm-reports", "visibility", layers.reports ? "visible" : "none");
    (map.getSource("cm-reports") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: reports.map((r) => ({
        type: "Feature",
        properties: { title: categoryLabel(r.category), when: new Date(r.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) },
        geometry: { type: "Point", coordinates: [r.lon, r.lat] },
      })),
    } as never);
  }, [ready, reports, layers.reports]);

  const toggle = (k: keyof MapLayerState) => setLayers((l) => ({ ...l, [k]: !l[k] }));
  const legend: { key: keyof MapLayerState; label: string; swatch: React.ReactNode }[] = [
    { key: "conditions", label: "Conditions along route", swatch: <span className="h-1 w-4 rounded-full bg-gradient-to-r from-caution to-critical" /> },
    { key: "hotspots", label: "Crash clusters", swatch: <span className="h-0 w-0 border-x-[6px] border-b-[10px] border-x-transparent border-b-critical" /> },
    { key: "institutions", label: "Schools & colleges", swatch: <span className="h-2.5 w-2.5 rounded-full bg-navy-900 ring-2 ring-white" /> },
    { key: "transit", label: "MARTA stops", swatch: <span className="h-2.5 w-2.5 rounded-full border-2 border-brand-600 bg-white" /> },
    { key: "reports", label: "Community reports", swatch: <span className="h-2.5 w-2.5 rounded-full bg-caution ring-2 ring-white" /> },
  ];

  return (
    <div className={`relative overflow-hidden bg-[#eef1f4] ${className}`}>
      <div ref={containerRef} className="h-full w-full" role="region" aria-label={ariaLabel ?? "Trip map. Route details are also listed in the panels beside the map."} />
      {!ready && !failed ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <span className="rounded-full bg-white/90 px-3 py-1.5 text-meta font-medium text-ink-muted shadow-[var(--shadow-panel)]">Loading map…</span>
        </div>
      ) : null}
      {loading ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[3px] overflow-hidden bg-brand-100" role="progressbar" aria-label="Analyzing route conditions">
          <div className="cm-progress h-full w-1/3 bg-brand-500" />
        </div>
      ) : null}
      {failed ? (
        <div className="absolute inset-x-4 top-4 rounded-chip border border-line bg-white px-3 py-2 text-meta text-ink-soft shadow-[var(--shadow-panel)]">
          The basemap could not be loaded. Route scores and details beside the map are unaffected.
        </div>
      ) : null}

      {showLegend ? (
        <div className="absolute left-3 top-3 z-10 max-w-[230px]">
          <button
            type="button"
            onClick={() => setLegendOpen((v) => !v)}
            aria-expanded={legendOpen}
            className="inline-flex items-center gap-1.5 rounded-chip border border-line bg-white/95 px-2.5 py-1.5 text-meta font-semibold text-navy-900 shadow-[var(--shadow-float)] backdrop-blur"
          >
            <Layers className="h-4 w-4 text-ink-muted" aria-hidden />
            Map layers
          </button>
          {legendOpen ? (
            <fieldset className="mt-1.5 rounded-ctl border border-line bg-white/95 p-2.5 shadow-[var(--shadow-float)] backdrop-blur animate-[var(--animate-fade-in)]">
              <legend className="sr-only">Map layers</legend>
              <div className="mb-1.5 flex items-center gap-2 px-1 text-meta text-ink-soft">
                <span className="h-1 w-4 rounded-full bg-brand-500" aria-hidden /> Selected route
                <span className="ml-1 h-1 w-4 rounded-full bg-[#8ea3bd]" aria-hidden /> Other
              </div>
              {legend.map((l) => (
                <label key={l.key} className="flex cursor-pointer items-center gap-2 rounded-chip px-1 py-1 text-meta text-ink hover:bg-subtle">
                  <input type="checkbox" className="h-3.5 w-3.5 accent-brand-600" checked={layers[l.key]} onChange={() => toggle(l.key)} />
                  <span className="grid w-4 place-items-center" aria-hidden>
                    {l.swatch}
                  </span>
                  {l.label}
                </label>
              ))}
            </fieldset>
          ) : null}
        </div>
      ) : null}

      <div className="absolute bottom-6 right-3 z-10 flex flex-col overflow-hidden rounded-chip border border-line bg-white shadow-[var(--shadow-float)]">
        <button type="button" aria-label="Zoom in" className="grid h-9 w-9 place-items-center text-ink-soft hover:bg-subtle hover:text-navy-900" onClick={() => mapRef.current?.zoomIn()}>
          <Plus className="h-4 w-4" aria-hidden />
        </button>
        <button type="button" aria-label="Zoom out" className="grid h-9 w-9 place-items-center border-t border-line text-ink-soft hover:bg-subtle hover:text-navy-900" onClick={() => mapRef.current?.zoomOut()}>
          <Minus className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Fit the trip in view"
          className="grid h-9 w-9 place-items-center border-t border-line text-ink-soft hover:bg-subtle hover:text-navy-900"
          onClick={() => {
            const map = mapRef.current;
            const pts: LonLat[] = [...(trip?.routes.flatMap((r) => r.geometry) ?? []), ...(from ? [[from.lon, from.lat] as LonLat] : []), ...(to ? [[to.lon, to.lat] as LonLat] : [])];
            const b = boundsOf(pts);
            if (map && b) map.fitBounds(b, { padding: pad, duration: 600, maxZoom: 16 });
          }}
        >
          <LocateFixed className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
