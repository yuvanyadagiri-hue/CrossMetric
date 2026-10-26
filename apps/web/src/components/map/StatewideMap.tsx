"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GeoJSONSource, Map as MapLibreMap, MapLayerMouseEvent, Marker } from "maplibre-gl";
import { ArrowRight, Bus, Layers, MapPin, MessageSquarePlus, Navigation, TrainFront, X } from "lucide-react";
import { PlaceCombobox } from "@/components/search/PlaceCombobox";
import { Segmented } from "@/components/ui/Segmented";
import { ButtonLink } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/States";
import { loadInstitutionRows } from "@/lib/institutions-client";
import { tripHref } from "@/lib/place-url";
import { categoryLabel, type CommunityReport } from "@/lib/reports";
import type { CrashCounts } from "@crossmetric/engine";
import type { LonLat, Place } from "@/lib/trip-types";
import { loadMapLibre } from "./loadMapLibre";
import { BASEMAP_STYLE } from "./mapTheme";
import { escapeHtml } from "./mapUtils";

type CrashFilter = "all" | "injury" | "pedestrian" | "bicyclist";
interface Layers {
  crashes: boolean;
  schools: boolean;
  colleges: boolean;
  hin: boolean;
  transit: boolean;
  reports: boolean;
}

interface PointInfo {
  radiusM: number;
  window: { start: string; end: string };
  road: { functionalClass: number; label: string; lanes: number | null; aadt: number | null } | null;
  crashes: CrashCounts;
  setting: { id: string; label: string; typicalCrashes: number };
  stops: { name: string; rail: boolean; routes: string[]; distanceM: number }[];
}

type Selection =
  | { kind: "point"; at: LonLat; info: PointInfo | null; error?: string }
  | { kind: "institution"; id: string; name: string; type: string; city: string; at: LonLat }
  | { kind: "report"; report: CommunityReport };

const GEORGIA: [LonLat, LonLat] = [
  [-85.65, 30.33],
  [-80.8, 35.03],
];
const EMPTY = { type: "FeatureCollection", features: [] } as never;
const DETAIL_ZOOM = 14;

export function StatewideMap({ focus }: { focus: LonLat | null }) {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const mlRef = useRef<typeof import("maplibre-gl") | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const [ready, setReady] = useState(false);
  const [layers, setLayers] = useState<Layers>({ crashes: true, schools: true, colleges: true, hin: false, transit: false, reports: true });
  const [filter, setFilter] = useState<CrashFilter>("all");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [zoom, setZoom] = useState(7);
  const [panelOpen, setPanelOpen] = useState(true);
  const filterRef = useRef(filter);
  useEffect(() => {
    filterRef.current = filter;
  }, [filter]);

  const inspect = useCallback(async (at: LonLat) => {
    setSelection({ kind: "point", at, info: null });
    try {
      const res = await fetch("/api/map/point", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lon: at[0], lat: at[1] }) });
      const body = (await res.json()) as PointInfo & { error?: string };
      setSelection((s) => (s?.kind === "point" && s.at === at ? (res.ok ? { ...s, info: body } : { ...s, error: body.error ?? "Unavailable" }) : s));
    } catch {
      setSelection((s) => (s?.kind === "point" && s.at === at ? { ...s, error: "CrossMetric could not be reached." } : s));
    }
  }, []);
  const inspectRef = useRef(inspect);
  useEffect(() => {
    inspectRef.current = inspect;
  }, [inspect]);

  // Create the map.
  useEffect(() => {
    let map: MapLibreMap | null = null;
    let cancelled = false;
    (async () => {
      const ml = await loadMapLibre();
      if (cancelled || !ref.current) return;
      mlRef.current = ml;
      map = new ml.Map({
        container: ref.current,
        style: BASEMAP_STYLE,
        bounds: focus ? [focus, focus] : GEORGIA,
        fitBoundsOptions: { padding: 30, maxZoom: 15 },
        attributionControl: { compact: true },
      });
      mapRef.current = map;
      map.addControl(new ml.NavigationControl({ showCompass: false }), "bottom-right");
      map.addControl(new ml.ScaleControl({ unit: "imperial", maxWidth: 100 }), "bottom-left");
      const popup = new ml.Popup({ closeButton: false, closeOnClick: false, offset: 10 });
      map.on("zoomend", () => map && setZoom(map.getZoom()));
      map.on("load", () => {
        if (!map) return;
        const firstLabel = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
        for (const id of ["grid", "crash-points", "hin", "rail", "stops", "institutions", "reports"]) map.addSource(id, { type: "geojson", data: EMPTY });
        map.addLayer(
          {
            id: "crash-heat",
            type: "heatmap",
            source: "grid",
            maxzoom: DETAIL_ZOOM + 0.5,
            paint: {
              "heatmap-weight": ["interpolate", ["linear"], ["get", "w"], 0, 0, 40, 1],
              "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 6, 0.6, 12, 1.6],
              "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 6, 6, 10, 14, 13, 28],
              "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 12, 0.85, DETAIL_ZOOM + 0.5, 0],
              "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(255,255,255,0)", 0.15, "#fde7a8", 0.4, "#f6b042", 0.65, "#ea6a2c", 0.85, "#d33a32", 1, "#8f1d1d"],
            },
          },
          firstLabel,
        );
        map.addLayer(
          {
            id: "crash-points",
            type: "circle",
            source: "crash-points",
            minzoom: DETAIL_ZOOM,
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 2.6, 18, 5],
              "circle-color": ["case", [">", ["%", ["floor", ["/", ["get", "f"], 4]], 2], 0], "#7c3aed", [">", ["%", ["get", "f"], 2], 0], "#e5484d", "#15191E"],
              "circle-opacity": 0.6,
              "circle-stroke-color": "#fff",
              "circle-stroke-width": 0.6,
            },
          },
          firstLabel,
        );
        map.addLayer({ id: "hin", type: "line", source: "hin", layout: { "line-cap": "round" }, paint: { "line-color": "#b42318", "line-width": ["interpolate", ["linear"], ["zoom"], 8, 1.2, 14, 4], "line-opacity": 0.75 } }, firstLabel);
        map.addLayer({ id: "rail", type: "line", source: "rail", paint: { "line-color": ["get", "color"], "line-width": ["interpolate", ["linear"], ["zoom"], 9, 2, 14, 5] } }, firstLabel);
        map.addLayer({
          id: "stops",
          type: "circle",
          source: "stops",
          minzoom: 12,
          paint: { "circle-radius": ["case", ["==", ["get", "rail"], 1], 5.5, 3], "circle-color": ["case", ["==", ["get", "rail"], 1], "#15191E", "#fff"], "circle-stroke-color": "#3E5C8A", "circle-stroke-width": 1.6 },
        });
        map.addLayer({
          id: "institutions",
          type: "circle",
          source: "institutions",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, ["match", ["get", "type"], "college", 3.2, 1.7], 10, ["match", ["get", "type"], "college", 5.5, 3.5], 15, 7],
            "circle-color": ["match", ["get", "type"], "college", "#3E5C8A", "#15191E"],
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 6, 0.4, 10, 1.4],
          },
        });
        map.addLayer({ id: "reports", type: "circle", source: "reports", paint: { "circle-radius": 6, "circle-color": "#f0a020", "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });

        const hover = (layer: string, html: (p: Record<string, unknown>) => string) => {
          map!.on("mousemove", layer, (e: MapLayerMouseEvent) => {
            const f = e.features?.[0];
            if (!f || !map) return;
            map.getCanvas().style.cursor = "pointer";
            popup.setLngLat(e.lngLat).setHTML(html(f.properties as Record<string, unknown>)).addTo(map);
          });
          map!.on("mouseleave", layer, () => {
            if (!map) return;
            map.getCanvas().style.cursor = "";
            popup.remove();
          });
        };
        const card = (t: string, s: string) => `<div style="font:500 12px var(--font-sans);color:#15191E"><div style="font-weight:600">${escapeHtml(t)}</div><div style="color:#5b6b80;margin-top:2px">${escapeHtml(s)}</div></div>`;
        hover("institutions", (p) => card(String(p.name), `${p.type === "college" ? "College" : String(p.level || "School")}${p.city ? ` · ${p.city}` : ""}`));
        hover("stops", (p) => card(String(p.name), `MARTA ${p.rail ? "rail" : "bus"}${p.routes ? ` · ${p.routes}` : ""}`));
        hover("hin", (p) => card("ARC High Injury Network", `Severity score ${p.severity ?? "n/a"} · validation reference, not used in scoring`));
        hover("reports", (p) => card(String(p.title), "Community report · unverified"));

        let handled = false;
        map.on("click", "institutions", (e: MapLayerMouseEvent) => {
          const f = e.features?.[0];
          if (!f) return;
          handled = true;
          const p = f.properties as { id: string; name: string; type: string; city: string };
          setSelection({ kind: "institution", id: p.id, name: p.name, type: p.type, city: p.city, at: [e.lngLat.lng, e.lngLat.lat] });
        });
        map.on("click", "reports", (e: MapLayerMouseEvent) => {
          const f = e.features?.[0];
          if (!f) return;
          handled = true;
          setSelection({ kind: "report", report: JSON.parse(String((f.properties as { json: string }).json)) as CommunityReport });
        });
        map.on("click", (e) => {
          if (handled) {
            handled = false;
            return;
          }
          void inspectRef.current([e.lngLat.lng, e.lngLat.lat]);
        });
        setZoom(map.getZoom());
        setReady(true);
      });
    })();
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Data layers, loaded when first shown.
  const loaded = useRef(new Set<string>());
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const vis = (id: string, on: boolean) => map.getLayer(id) && map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    vis("crash-heat", layers.crashes);
    vis("crash-points", layers.crashes);
    vis("hin", layers.hin);
    vis("rail", layers.transit);
    vis("stops", layers.transit);
    vis("institutions", layers.schools || layers.colleges);
    vis("reports", layers.reports);
    map.setFilter("institutions", layers.schools && layers.colleges ? null : ["==", ["get", "type"], layers.colleges ? "college" : "k12"]);
    const once = (key: string, load: () => Promise<void>) => {
      if (loaded.current.has(key)) return;
      loaded.current.add(key);
      load().catch(() => loaded.current.delete(key));
    };
    if (layers.crashes)
      once("grid", async () => {
        const g = (await (await fetch("/api/map/crash-grid")).json()) as Record<CrashFilter | "lon" | "lat", number[]>;
        (map.getSource("grid") as GeoJSONSource).setData({
          type: "FeatureCollection",
          features: g.lon.map((lon, i) => ({ type: "Feature", properties: { all: g.all[i], injury: g.injury[i], pedestrian: g.pedestrian[i], bicyclist: g.bicyclist[i], w: g[filterRef.current][i] }, geometry: { type: "Point", coordinates: [lon, g.lat[i]] } })),
        } as never);
      });
    if (layers.schools || layers.colleges)
      once("institutions", async () => {
        const rows = await loadInstitutionRows();
        (map.getSource("institutions") as GeoJSONSource).setData({
          type: "FeatureCollection",
          features: rows.map((r) => ({ type: "Feature", properties: { id: r.id, type: r.type, name: r.name, city: r.city ?? "", level: r.level ?? "" }, geometry: { type: "Point", coordinates: [r.lon, r.lat] } })),
        } as never);
      });
    if (layers.hin) once("hin", async () => (map.getSource("hin") as GeoJSONSource).setData((await (await fetch("/api/map/hin")).json()) as never));
    if (layers.transit)
      once("transit", async () => {
        const t = (await (await fetch("/api/map/transit")).json()) as { stops: { name: string[]; lon: number[]; lat: number[]; rail: boolean[]; routes: string[][] }; railLines: unknown };
        (map.getSource("rail") as GeoJSONSource).setData(t.railLines as never);
        (map.getSource("stops") as GeoJSONSource).setData({
          type: "FeatureCollection",
          features: t.stops.name.map((name, i) => ({ type: "Feature", properties: { name, rail: t.stops.rail[i] ? 1 : 0, routes: (t.stops.routes[i] ?? []).join(", ") }, geometry: { type: "Point", coordinates: [t.stops.lon[i], t.stops.lat[i]] } })),
        } as never);
      });
    if (layers.reports)
      once("reports", async () => {
        const { reports } = (await (await fetch("/api/reports")).json()) as { reports: CommunityReport[] };
        (map.getSource("reports") as GeoJSONSource).setData({
          type: "FeatureCollection",
          features: reports.map((r) => ({ type: "Feature", properties: { title: categoryLabel(r.category), json: JSON.stringify(r) }, geometry: { type: "Point", coordinates: [r.lon, r.lat] } })),
        } as never);
      });
  }, [ready, layers]);

  // Crash filter changes the heat weight.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.setPaintProperty("crash-heat", "heatmap-weight", ["interpolate", ["linear"], ["get", filter], 0, 0, filter === "all" ? 40 : filter === "injury" ? 12 : 2, 1]);
    const flag = { all: 0, injury: 1, pedestrian: 4, bicyclist: 8 }[filter];
    map.setFilter("crash-points", flag ? [">", ["%", ["floor", ["/", ["get", "f"], flag]], 2], 0] : null);
  }, [ready, filter]);

  // Individual crashes when zoomed in.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !layers.crashes) return;
    let controller: AbortController | null = null;
    const load = () => {
      if (map.getZoom() < DETAIL_ZOOM) return;
      const b = map.getBounds();
      controller?.abort();
      controller = new AbortController();
      fetch(`/api/map/crashes?bbox=${[b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((v) => v.toFixed(4)).join(",")}`, { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { lon: number[]; lat: number[]; flags: number[] } | null) => {
          if (!d) return;
          (map.getSource("crash-points") as GeoJSONSource).setData({
            type: "FeatureCollection",
            features: d.lon.map((lon, i) => ({ type: "Feature", properties: { f: d.flags[i] }, geometry: { type: "Point", coordinates: [lon, d.lat[i]] } })),
          } as never);
        })
        .catch(() => undefined);
    };
    load();
    map.on("moveend", load);
    return () => {
      map.off("moveend", load);
      controller?.abort();
    };
  }, [ready, layers.crashes]);

  // Selection marker + focus from URL.
  useEffect(() => {
    const map = mapRef.current;
    const ml = mlRef.current;
    if (!ready || !map || !ml) return;
    markerRef.current?.remove();
    markerRef.current = null;
    const at = selection?.kind === "point" ? selection.at : selection?.kind === "report" ? ([selection.report.lon, selection.report.lat] as LonLat) : selection?.kind === "institution" ? selection.at : null;
    if (!at) return;
    const el = document.createElement("div");
    el.style.cssText = "width:18px;height:18px;border-radius:50%;background:#3B6FD8;box-shadow:0 0 0 4px rgba(59,111,216,.22),0 0 0 2px #fff inset";
    markerRef.current = new ml.Marker({ element: el }).setLngLat(at).addTo(map);
  }, [ready, selection]);

  const focused = useRef(false);
  useEffect(() => {
    if (!ready || !focus || focused.current) return;
    focused.current = true;
    const t = setTimeout(() => void inspect(focus), 0);
    return () => clearTimeout(t);
  }, [ready, focus, inspect]);

  const flyTo = (p: Place) => {
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({ center: [p.lon, p.lat], zoom: 15, duration: 1200 });
    if ((p.kind === "school" || p.kind === "college") && p.id) setSelection({ kind: "institution", id: p.id, name: p.label, type: p.kind === "college" ? "college" : "k12", city: p.sublabel ?? "", at: [p.lon, p.lat] });
    else void inspect([p.lon, p.lat]);
  };

  const toggle = (k: keyof Layers) => setLayers((l) => ({ ...l, [k]: !l[k] }));
  const LAYER_ROWS: { key: keyof Layers; label: string; note: string; swatch: React.ReactNode }[] = [
    { key: "crashes", label: "Crash density", note: "GDOT reports; points at street level", swatch: <span className="h-3 w-5 rounded-sm bg-gradient-to-r from-[#fde7a8] via-[#ea6a2c] to-[#8f1d1d]" /> },
    { key: "schools", label: "K–12 schools", note: "NCES 2024–25", swatch: <span className="h-2.5 w-2.5 rounded-full bg-navy-900 ring-2 ring-white" /> },
    { key: "colleges", label: "Colleges", note: "IPEDS 2024–25", swatch: <span className="h-2.5 w-2.5 rounded-full bg-brand-600 ring-2 ring-white" /> },
    { key: "hin", label: "High Injury Network", note: "ARC, metro Atlanta (reference only)", swatch: <span className="h-1 w-5 rounded-full bg-critical-fg" /> },
    { key: "transit", label: "MARTA transit", note: "Rail lines and stops (GTFS)", swatch: <span className="h-2.5 w-2.5 rounded-full border-2 border-brand-600 bg-white" /> },
    { key: "reports", label: "Community reports", note: "Unverified", swatch: <span className="h-2.5 w-2.5 rounded-full bg-caution ring-2 ring-white" /> },
  ];

  return (
    <div className="relative h-full w-full">
      <div ref={ref} className="h-full w-full" role="region" aria-label="Statewide map of Georgia: crashes, schools, colleges, transit and reports. Use the search to jump to a place." />
      {!ready ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <span className="rounded-full bg-white/90 px-3 py-1.5 text-meta font-medium text-ink-muted shadow-[var(--shadow-panel)]">Loading map…</span>
        </div>
      ) : null}

      <div className="absolute left-3 top-3 z-10 flex max-h-[calc(100%-24px)] w-[min(360px,calc(100%-24px))] flex-col gap-2">
        <div className="card p-2 shadow-[var(--shadow-float)]">
          <PlaceCombobox label="Search the map" value={null} onSelect={flyTo} placeholder="Search a school, college, or address…" variant="search" />
        </div>
        <div className="card overflow-hidden shadow-[var(--shadow-float)]">
          <button type="button" onClick={() => setPanelOpen((v) => !v)} aria-expanded={panelOpen} className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-small font-semibold text-navy-900">
            <Layers className="h-4 w-4 text-ink-muted" aria-hidden /> Layers
            <span className="ml-auto text-meta font-normal text-ink-muted">{panelOpen ? "Hide" : "Show"}</span>
          </button>
          {panelOpen ? (
            <div className="space-y-3 border-t border-line px-3.5 py-3">
              <fieldset className="space-y-1">
                <legend className="sr-only">Map layers</legend>
                {LAYER_ROWS.map((l) => (
                  <label key={l.key} className="flex cursor-pointer items-start gap-2.5 rounded-chip px-1 py-1 hover:bg-subtle">
                    <input type="checkbox" className="mt-0.5 h-3.5 w-3.5 accent-brand-600" checked={layers[l.key]} onChange={() => toggle(l.key)} />
                    <span className="mt-1 grid w-5 place-items-center" aria-hidden>
                      {l.swatch}
                    </span>
                    <span>
                      <span className="block text-small font-medium text-ink">{l.label}</span>
                      <span className="block text-meta text-ink-muted">{l.note}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              {layers.crashes ? (
                <div>
                  <p className="mb-1.5 text-meta font-semibold text-ink-soft">Crashes shown</p>
                  <Segmented
                    label="Crash filter"
                    size="sm"
                    value={filter}
                    onChange={setFilter}
                    options={[
                      { id: "all", label: "All" },
                      { id: "injury", label: "Injury" },
                      { id: "pedestrian", label: "Ped." },
                      { id: "bicyclist", label: "Bike" },
                    ]}
                  />
                  <p className="mt-1.5 text-meta text-ink-muted">{zoom < DETAIL_ZOOM ? "Zoom in to street level to see individual crashes." : "Purple: pedestrian · red: injury · navy: other."}</p>
                </div>
              ) : null}
              <p className="text-meta text-ink-muted">Click anywhere on the map for that spot&rsquo;s road, crashes and transit.</p>
            </div>
          ) : null}
        </div>
      </div>

      {selection ? (
        <aside className="card absolute bottom-3 right-3 z-10 w-[min(380px,calc(100%-24px))] p-4 shadow-[var(--shadow-pop)] animate-[var(--animate-rise)] sm:bottom-auto sm:top-3" aria-label="Selected location" aria-live="polite">
          <button type="button" onClick={() => setSelection(null)} className="btn-quiet absolute right-2 top-2" aria-label="Close">
            <X className="h-4 w-4" aria-hidden />
          </button>
          {selection.kind === "institution" ? (
            <div>
              <p className="eyebrow">{selection.type === "college" ? "College" : "School"}</p>
              <h2 className="mt-1 pr-6 text-body font-semibold text-navy-900">{selection.name}</h2>
              <p className="text-small text-ink-muted">{selection.city}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <ButtonLink href={`/schools/${selection.id}`} size="sm">
                  Profile
                </ButtonLink>
                <ButtonLink href={`/analyze/${selection.id}`} size="sm" variant="secondary">
                  Analyze
                </ButtonLink>
                <ButtonLink
                  href={tripHref("/routes", null, { label: selection.name, lon: selection.at[0], lat: selection.at[1], kind: selection.type === "college" ? "college" : "school", id: selection.id }, "walk")}
                  size="sm"
                  variant="secondary"
                >
                  Plan a trip
                </ButtonLink>
              </div>
            </div>
          ) : selection.kind === "report" ? (
            <div>
              <p className="eyebrow">Community report · unverified</p>
              <h2 className="mt-1 pr-6 text-body font-semibold text-navy-900">{categoryLabel(selection.report.category)}</h2>
              {selection.report.locationLabel ? <p className="text-small text-ink-muted">{selection.report.locationLabel}</p> : null}
              {selection.report.description ? <p className="mt-2 text-small leading-relaxed text-ink-soft">{selection.report.description}</p> : null}
              <Link href="/reports" className="link mt-3 inline-flex items-center gap-1 text-small">
                Open reports <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </div>
          ) : (
            <PointPanel selection={selection} onPlan={() => router.push(tripHref("/routes", null, { label: "Selected point", lon: selection.at[0], lat: selection.at[1], kind: "place" }, "walk"))} />
          )}
        </aside>
      ) : null}
    </div>
  );
}

function PointPanel({ selection, onPlan }: { selection: Extract<Selection, { kind: "point" }>; onPlan: () => void }) {
  const info = selection.info;
  const [lon, lat] = selection.at;
  return (
    <div>
      <p className="eyebrow flex items-center gap-1">
        <MapPin className="h-3.5 w-3.5" aria-hidden /> Location intelligence
      </p>
      {selection.error ? (
        <p className="mt-2 text-small text-critical-fg">{selection.error}</p>
      ) : !info ? (
        <div className="mt-3 space-y-2" aria-busy="true" aria-label="Loading location details">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-4 w-40" />
        </div>
      ) : (
        <div className="mt-1">
          <h2 className="pr-6 text-body font-semibold text-navy-900">{info.road ? info.road.label : "Local street or path"}</h2>
          <p className="text-meta text-ink-muted">
            {info.road
              ? [info.road.lanes ? `${info.road.lanes} through lanes` : null, info.road.aadt ? `${info.road.aadt.toLocaleString("en-US")} vehicles/day (GDOT)` : "No GDOT traffic count"].filter(Boolean).join(" · ")
              : "Not a GDOT-classified major road"}
            {` · ${info.setting.label.replace(/^./, (c) => c.toUpperCase())}`}
          </p>
          <dl className="mt-3 grid grid-cols-4 gap-2 rounded-chip bg-subtle p-2.5 text-center">
            {[
              [info.crashes.all, "Crashes"],
              [info.crashes.injury, "Injury"],
              [info.crashes.pedestrian, "Ped."],
              [info.crashes.bicyclist, "Bike"],
            ].map(([v, l]) => (
              <div key={l as string}>
                <dd className="tabular text-component font-semibold text-navy-900">{v}</dd>
                <dt className="text-meta text-ink-muted">{l}</dt>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-meta leading-snug text-ink-muted">
            Surface-street crashes within {info.radiusM} m, {info.window.start.slice(0, 4)}–{info.window.end.slice(0, 4)}. About {info.setting.typicalCrashes} would be typical here for {info.setting.label}.
          </p>
          {info.stops.length ? (
            <ul className="mt-2 space-y-1 text-meta text-ink-soft">
              {info.stops.map((s) => (
                <li key={s.name} className="flex items-center gap-1.5">
                  {s.rail ? <TrainFront className="h-3.5 w-3.5 text-brand-600" aria-hidden /> : <Bus className="h-3.5 w-3.5 text-brand-600" aria-hidden />}
                  {s.name} · {s.distanceM} m
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={onPlan} className="btn btn-primary btn-sm">
          <Navigation className="h-4 w-4" aria-hidden /> Plan a trip here
        </button>
        <Link href={`/reports?new=1&at=${lon.toFixed(5)},${lat.toFixed(5)}`} className="btn btn-secondary btn-sm">
          <MessageSquarePlus className="h-4 w-4" aria-hidden /> Report an issue
        </Link>
      </div>
    </div>
  );
}
