"use client";

import { useEffect, useRef, useState } from "react";
import type { GeoJSONSource, LngLatBoundsLike, Map as MapLibreMap, MapGeoJSONFeature, Marker } from "maplibre-gl";
import { Layers, LocateFixed, Minus, Plus } from "lucide-react";
import type { Building, CampusBundle, LonLat, ParkingResult, PlanLeg } from "@/lib/commute-types";
import { loadMapLibre } from "@/components/map/loadMapLibre";
import { fitPadding } from "./motion";

const STYLES = { light: "https://tiles.openfreemap.org/styles/positron", dark: "https://tiles.openfreemap.org/styles/dark" };
const FONT = ["Noto Sans Regular"];
const ATLANTA: LonLat = [-84.388, 33.749];

type Feature = GeoJSON.Feature<GeoJSON.Geometry, Record<string, unknown>>;
type Fc = GeoJSON.FeatureCollection<GeoJSON.Geometry, Record<string, unknown>>;
const EMPTY: Fc = { type: "FeatureCollection", features: [] };

export interface MapStop {
  id: string;
  name: string;
  lon: number;
  lat: number;
  color: string;
  role: "board" | "alight" | "transfer";
}

export interface MapStation {
  id: string;
  name: string;
  lon: number;
  lat: number;
  kind: "rail" | "bus";
  selected: boolean;
}

export interface MapDestination {
  point: LonLat;
  label: string;
  building?: Building | null;
}

export interface CommuteMapProps {
  bundle: CampusBundle | null;
  theme: "light" | "dark";
  /** Unobstructed map region, in px from each edge (sheet, search bar, side panel). */
  insets: { top: number; bottom: number; left: number; right: number };
  destination: MapDestination | null;
  origin: LonLat | null;
  userLocation: LonLat | null;
  routes: { option: { id: string; legs: PlanLeg[] }; selected: boolean }[];
  parking: { results: Map<string, ParkingResult>; selectedId: string | null; visibleIds: Set<string> } | null;
  parkedCar: LonLat | null;
  stops: MapStop[];
  stations: MapStation[];
  /** When this changes, the camera re-frames to the current content. */
  frameKey: string;
  /** When this changes, the selected route draws itself in (skipped with reduced motion). */
  drawKey: string;
  reducedMotion: boolean;
  /** During a trip: frame this leg of the selected route. */
  focusLeg?: number | null;
  /** Extra points that must be in view (e.g. the parked car). */
  framePoints?: LonLat[];
  /** "Choose on map": a fixed pin marks the map centre; clicks do not select things. */
  picking?: boolean;
  onCenter?: (c: LonLat) => void;
  onLocate?: () => void;
  /** The layers button switches the basemap between dark and light. */
  onToggleStyle?: () => void;
  locating?: boolean;
  onSelectRoute?: (id: string) => void;
  onSelectParking?: (id: string) => void;
  onSelectStop?: (stop: MapStop) => void;
  onSelectBuilding?: (id: string) => void;
  onSelectStation?: (id: string) => void;
  /** Community barrier reports to draw (open ones amber, reported-fixed ones grey). */
  reports?: MapReport[];
  onSelectReport?: (id: string) => void;
  /** Move the camera to a point (a report location chosen from search or the person's location). */
  flyTo?: { point: LonLat; key: number } | null;
}

export interface MapReport {
  id: string;
  lon: number;
  lat: number;
  status: "open" | "fixed";
  confirmed: boolean;
  selected: boolean;
}

function pointInRing(pt: LonLat, ring: LonLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function boundsOf(points: LonLat[]): [LonLat, LonLat] | null {
  if (!points.length) return null;
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return [
    [minX, minY],
    [maxX, maxY],
  ];
}

const dist = (a: LonLat, b: LonLat) => Math.hypot((a[0] - b[0]) * Math.cos((a[1] * Math.PI) / 180), a[1] - b[1]);

/** Camera easing: a gentle start and a long, soft landing. */
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** The first `share` of a polyline (0..1 of its length). */
function sliceLine(line: LonLat[], share: number): LonLat[] {
  if (share >= 1 || line.length < 2) return line;
  const seg: number[] = [];
  let total = 0;
  for (let i = 1; i < line.length; i++) {
    const d = dist(line[i - 1]!, line[i]!);
    seg.push(d);
    total += d;
  }
  let left = total * Math.max(0, share);
  const out: LonLat[] = [line[0]!];
  for (let i = 1; i < line.length; i++) {
    const d = seg[i - 1]!;
    if (left >= d) {
      out.push(line[i]!);
      left -= d;
      continue;
    }
    const t = d === 0 ? 0 : left / d;
    const a = line[i - 1]!;
    const b = line[i]!;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    break;
  }
  return out;
}

/**
 * The dark basemap (OpenFreeMap "dark") is neutral grey; these paints retint it to CrossMetric's
 * navy so the map and the panels are one surface. Keyed by the style's layer ids; a prefix entry
 * ("place_") covers every layer that starts with it. Unknown layers keep their own colours.
 */
const NAVY_PAINT: Record<string, Record<string, string>> = {
  background: { "background-color": "#07111F" },
  water: { "fill-color": "#0B1E36" },
  waterway: { "line-color": "#0B1E36" },
  landcover_ice_shelf: { "fill-color": "#07111F" },
  landcover_glacier: { "fill-color": "#07111F" },
  landuse_residential: { "fill-color": "#081525" },
  landcover_wood: { "fill-color": "#0A1B27" },
  landuse_park: { "fill-color": "#0A1C27" },
  building: { "fill-color": "#0B1828", "fill-outline-color": "#13233A" },
  "aeroway-taxiway": { "line-color": "#13233A" },
  "aeroway-runway-casing": { "line-color": "#1B2A3E" },
  "aeroway-area": { "fill-color": "#081525" },
  "aeroway-runway": { "line-color": "#0D1929" },
  road_area_pier: { "fill-color": "#07111F" },
  road_pier: { "line-color": "#07111F" },
  highway_path: { "line-color": "#17283E" },
  highway_minor: { "line-color": "#16263C" },
  highway_major_casing: { "line-color": "#22344D" },
  highway_major_inner: { "line-color": "#111F33" },
  highway_major_subtle: { "line-color": "#1E3047" },
  highway_motorway_casing: { "line-color": "#2B3E58" },
  highway_motorway_inner: { "line-color": "#15263D" },
  highway_motorway_subtle: { "line-color": "#1C2D44" },
  railway_transit: { "line-color": "#1E3049" },
  railway_minor: { "line-color": "#1E3049" },
  railway: { "line-color": "#1E3049" },
  railway_transit_dashline: { "line-color": "#07111F" },
  railway_minor_dashline: { "line-color": "#07111F" },
  railway_dashline: { "line-color": "#07111F" },
  water_name: { "text-color": "#56739A", "text-halo-color": "#07111F" },
  highway_name_other: { "text-color": "#71839B", "text-halo-color": "#07111F" },
  highway_name_motorway: { "text-color": "#7F90A7" },
  boundary_: { "line-color": "#2B3D55" },
  place_: { "text-color": "#8D9EB4", "text-halo-color": "rgba(7,17,31,0.85)" },
};

function tintNavy(map: MapLibreMap) {
  for (const layer of map.getStyle().layers ?? []) {
    const paint = NAVY_PAINT[layer.id] ?? (layer.id.startsWith("place_") ? NAVY_PAINT.place_ : layer.id.startsWith("boundary_") ? NAVY_PAINT.boundary_ : null);
    if (!paint) continue;
    for (const [k, v] of Object.entries(paint)) {
      try {
        map.setPaintProperty(layer.id, k as Parameters<MapLibreMap["setPaintProperty"]>[1], v);
      } catch {
        // A property this layer type does not have: leave it.
      }
    }
  }
}

const PARKING_FILL = "#59616c";
const ELIG_LINE: Record<string, string> = { allowed: "#0b7366", requires_action: "#3e5c8a", prohibited: "#b02e25", unknown: "#7a828d" };

function hatchImage(dark: boolean): ImageData {
  const size = 8;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d")!;
  g.strokeStyle = dark ? "rgba(200,206,214,0.45)" : "rgba(89,97,108,0.45)";
  g.lineWidth = 1.2;
  g.beginPath();
  g.moveTo(0, size);
  g.lineTo(size, 0);
  g.stroke();
  return g.getImageData(0, 0, size, size);
}

// Lucide glyphs (train-front, bus) drawn onto map icons.
const GLYPHS = {
  rail: ["M8 3.1V7a4 4 0 0 0 8 0V3.1", "m9 15-1-1", "m15 15 1-1", "M9 19c-2.8 0-5-2.2-5-5v-4a8 8 0 0 1 16 0v4c0 2.8-2.2 5-5 5Z", "m8 19-2 3", "m16 19 2 3"],
  bus: ["M8 6v6", "M15 6v6", "M2 12h19.6", "M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3", "M9 18h5", "M7 16a2 2 0 1 0 0 4 2 2 0 1 0 0-4", "M16 16a2 2 0 1 0 0 4 2 2 0 1 0 0-4"],
};

function iconImage(kind: "rail" | "bus", bg: string, fg: string, ring: string): ImageData {
  const px = 2;
  const size = 30 * px;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d")!;
  g.fillStyle = ring;
  g.beginPath();
  g.arc(size / 2, size / 2, size / 2 - px, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = bg;
  g.beginPath();
  g.arc(size / 2, size / 2, size / 2 - 3 * px, 0, Math.PI * 2);
  g.fill();
  g.save();
  g.translate(size / 2 - 8 * px, size / 2 - 8 * px);
  g.scale((16 / 24) * px, (16 / 24) * px);
  g.strokeStyle = fg;
  g.lineWidth = 2.2;
  g.lineCap = "round";
  g.lineJoin = "round";
  for (const d of GLYPHS[kind]) g.stroke(new Path2D(d));
  g.restore();
  return g.getImageData(0, 0, size, size);
}

/**
 * HTML markers. MapLibre positions the outer element with a transform, so the entrance
 * animation runs on an inner element (classes in globals.css; off with reduced motion).
 */
function markerEl(kind: "destination" | "origin" | "car" | "me", label: string): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", label);
  el.title = label;
  const inner = document.createElement("div");
  el.appendChild(inner);
  if (kind === "destination") {
    el.className = "cm-marker-drop";
    inner.innerHTML =
      '<svg width="34" height="44" viewBox="0 0 34 44" aria-hidden="true" style="display:block;filter:drop-shadow(0 3px 4px rgba(7,17,31,.35))"><path d="M17 43s15-14 15-25.5A15 15 0 0 0 2 17.5C2 29 17 43 17 43Z" fill="#07111F" stroke="#fff" stroke-width="2"/><circle cx="17" cy="17.5" r="5.5" fill="#91F24D"/></svg>';
    el.style.cssText = "width:34px;height:44px";
  } else if (kind === "origin") {
    el.className = "cm-marker-pop";
    el.style.cssText = "width:18px;height:18px";
    inner.style.cssText = "width:18px;height:18px;border-radius:50%;background:#91F24D;box-shadow:0 0 0 4px #07111F,0 0 0 6px #fff,0 1px 6px rgba(7,17,31,.5)";
  } else if (kind === "me") {
    el.className = "cm-marker-me";
    el.style.cssText = "width:16px;height:16px";
    inner.style.cssText = "width:16px;height:16px;border-radius:50%;background:#42A5FF;border:3px solid #fff;box-sizing:border-box;box-shadow:0 0 0 7px rgba(66,165,255,.18),0 1px 3px rgba(7,17,31,.4)";
  } else {
    el.className = "cm-marker-pop";
    el.style.cssText = "width:32px;height:32px";
    inner.style.cssText = "width:32px;height:32px;border-radius:10px;background:#07111F;display:grid;place-items:center;box-shadow:0 0 0 2px #fff,0 2px 6px rgba(7,17,31,.35)";
    inner.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#91F24D" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>';
  }
  return el;
}

export function CommuteMap(props: CommuteMapProps) {
  const { bundle, theme, insets, destination, origin, userLocation, routes, parking, parkedCar, stops, stations, frameKey, drawKey, picking } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const mlRef = useRef<typeof import("maplibre-gl") | null>(null);
  const markers = useRef<Record<string, Marker | null>>({});
  const handlers = useRef(props);
  const [ready, setReady] = useState(0);
  const [failed, setFailed] = useState(false);
  const themeRef = useRef(theme);
  const drawn = useRef<string>("");
  const destMarkerKey = useRef<string>("");

  useEffect(() => {
    handlers.current = props;
  });

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | null = null;
    (async () => {
      try {
        const ml = await loadMapLibre();
        if (cancelled || !containerRef.current) return;
        mlRef.current = ml;
        map = new ml.Map({
          container: containerRef.current,
          style: STYLES[themeRef.current],
          center: ATLANTA,
          zoom: 11,
          attributionControl: { compact: false },
          pitchWithRotate: false,
          dragRotate: false,
          touchPitch: false,
          fadeDuration: 0,
        });
        mapRef.current = map;
        map.touchZoomRotate.disableRotation();
        map.on("style.load", () => {
          if (themeRef.current === "dark") tintNavy(map!);
          addLayers(map!, themeRef.current === "dark");
          setReady((n) => n + 1);
        });
        map.on("error", () => undefined);
        // The centre is reported once loaded and after every move (Report a barrier and "choose on map" read it).
        const reportCenter = () => {
          const c = map!.getCenter();
          handlers.current.onCenter?.([c.lng, c.lat]);
        };
        map.once("load", reportCenter);
        map.on("moveend", reportCenter);
        const clickable = ["cm-reports", "cm-parking-fill", "cm-parking-pts", "cm-stops", "cm-stations", "cm-route-hit"];
        map.on("click", (e) => {
          const h = handlers.current;
          if (h.picking) return;
          const feats = map!.queryRenderedFeatures(e.point, { layers: clickable.filter((l) => map!.getLayer(l)) }) as MapGeoJSONFeature[];
          const f = feats[0];
          if (f?.layer.id === "cm-reports") {
            h.onSelectReport?.(String(f.properties.id));
            return;
          }
          if (f?.layer.id === "cm-stations") {
            h.onSelectStation?.(String(f.properties.id));
            return;
          }
          if (f?.layer.id === "cm-stops") {
            const s = h.stops.find((x) => x.id === f.properties.id);
            if (s) h.onSelectStop?.(s);
            return;
          }
          if (f && (f.layer.id === "cm-parking-fill" || f.layer.id === "cm-parking-pts")) {
            if (f.properties.cluster) {
              map!.easeTo({ center: e.lngLat, zoom: map!.getZoom() + 1.5 });
              return;
            }
            h.onSelectParking?.(String(f.properties.id));
            return;
          }
          if (f?.layer.id === "cm-route-hit") {
            h.onSelectRoute?.(String(f.properties.option));
            return;
          }
          const pt: LonLat = [e.lngLat.lng, e.lngLat.lat];
          const b = h.bundle?.buildings.find((x) => x.outline.some((poly) => pointInRing(pt, poly[0]!)));
          if (b) h.onSelectBuilding?.(b.id);
        });
        for (const l of clickable) {
          map.on("mouseenter", l, () => (map!.getCanvas().style.cursor = "pointer"));
          map.on("mouseleave", l, () => (map!.getCanvas().style.cursor = ""));
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  // Appearance changes swap the basemap; layers are re-added on style.load.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || themeRef.current === theme) return;
    themeRef.current = theme;
    drawn.current = "";
    map.setStyle(STYLES[theme]);
  }, [theme]);

  // Selected campus building outline.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const b = destination?.building;
    (map.getSource("cm-building") as GeoJSONSource | undefined)?.setData(
      b ? { type: "FeatureCollection", features: b.outline.map((poly): Feature => ({ type: "Feature", properties: { verified: b.entrances.length > 0 }, geometry: { type: "Polygon", coordinates: poly } })) } : EMPTY,
    );
  }, [destination, ready]);

  // Routes: alternatives subdued; the selected one prominent with mode styles, drawn in when it changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = map.getSource("cm-routes") as GeoJSONSource | undefined;
    if (!src) return;
    const build = (share: number): Fc => {
      const features: Feature[] = [];
      for (const { option, selected } of routes) {
        const legs = option.legs.filter((l) => l.geometry.length >= 2);
        // Reveal the selected route leg by leg in proportion to its length.
        const lengths = legs.map((l) => l.geometry.reduce((s, p, i) => (i ? s + dist(l.geometry[i - 1]!, p) : 0), 0));
        const total = lengths.reduce((a, b) => a + b, 0) || 1;
        let before = 0;
        legs.forEach((leg, i) => {
          let geom = leg.geometry;
          if (selected && share < 1) {
            const local = (share * total - before) / (lengths[i]! || 1);
            before += lengths[i]!;
            if (local <= 0) return;
            geom = sliceLine(leg.geometry, local);
            if (geom.length < 2) return;
          }
          const kind = leg.kind === "ride" ? "ride" : leg.kind === "walk" ? "walk" : "drive";
          features.push({
            type: "Feature",
            properties: { option: option.id, selected: selected ? 1 : 0, kind, color: leg.route?.color && leg.route.color !== "#000000" ? leg.route.color : "" },
            geometry: { type: "LineString", coordinates: geom },
          });
        });
      }
      return { type: "FeatureCollection", features };
    };
    const sel = routes.find((r) => r.selected);
    const animate = !!sel && drawKey !== drawn.current && !props.reducedMotion;
    drawn.current = drawKey;
    if (!animate) {
      src.setData(build(1));
      return;
    }
    let raf = 0;
    const start = performance.now();
    const DURATION = 700;
    let last = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / DURATION);
      // Ease out: quick start, gentle arrival.
      const e = 1 - Math.pow(1 - p, 3);
      if (t - last > 30 || p === 1) {
        src.setData(build(e));
        last = t;
      }
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      try {
        src.setData(build(1));
      } catch {
        // The map was removed.
      }
    };
    // props.reducedMotion is read at draw time on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes, ready, drawKey]);

  // Parking: eligibility draws the border (hatched when unknown).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const polys: Feature[] = [];
    const pts: Feature[] = [];
    if (parking && bundle) {
      for (const p of bundle.parking) {
        if (!parking.visibleIds.has(p.id)) continue;
        const r = parking.results.get(p.id);
        const props = { id: p.id, code: p.code, status: r?.status ?? "unknown", selected: parking.selectedId === p.id ? 1 : 0 };
        for (const poly of p.polygons) polys.push({ type: "Feature", properties: props, geometry: { type: "Polygon", coordinates: poly } });
        pts.push({ type: "Feature", properties: props, geometry: { type: "Point", coordinates: p.center } });
      }
    }
    (map.getSource("cm-parking") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: polys });
    (map.getSource("cm-parking-pts") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: pts });
  }, [parking, bundle, ready]);

  // Stops of the selected itinerary only (no unrelated routes or vehicles).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource("cm-stops") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: stops.map((s): Feature => ({ type: "Feature", properties: { id: s.id, name: s.name, color: s.color, role: s.role }, geometry: { type: "Point", coordinates: [s.lon, s.lat] } })),
    });
  }, [stops, ready]);

  // Nearby stations and stops (a short, ranked list; never every stop in the region).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource("cm-stations") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: stations.map((s): Feature => ({ type: "Feature", properties: { id: s.id, name: s.name, kind: s.kind, icon: `cm-${s.kind}${s.selected ? "-on" : ""}`, selected: s.selected ? 1 : 0 }, geometry: { type: "Point", coordinates: [s.lon, s.lat] } })),
    });
  }, [stations, ready]);

  // Community reports: a small circle per report (the panel lists the same reports in words).
  const reports = props.reports;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource("cm-reports") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: (reports ?? []).map((r): Feature => ({ type: "Feature", properties: { id: r.id, status: r.status, confirmed: r.confirmed ? 1 : 0, selected: r.selected ? 1 : 0 }, geometry: { type: "Point", coordinates: [r.lon, r.lat] } })),
    });
  }, [reports, ready]);

  // While a point is being chosen, the camera's padding is exactly the uncovered area, so the map's
  // centre is the point under the pin (the pin is drawn at the centre of that same area).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !picking) return;
    map.setPadding({ top: insets.top, bottom: insets.bottom, left: insets.left, right: insets.right });
    const c = map.getCenter();
    handlers.current.onCenter?.([c.lng, c.lat]);
  }, [picking, ready, insets.top, insets.bottom, insets.left, insets.right]);

  // Fly to a point on request.
  const flyKey = props.flyTo?.key ?? null;
  useEffect(() => {
    const map = mapRef.current;
    const f = handlers.current.flyTo;
    if (!map || !ready || !f) return;
    const c = map.getContainer();
    const pad = handlers.current.picking ? { top: insets.top, bottom: insets.bottom, left: insets.left, right: insets.right } : fitPadding(insets, c.clientWidth, c.clientHeight);
    map.easeTo({ center: f.point, zoom: Math.max(map.getZoom(), 17), padding: pad, duration: handlers.current.reducedMotion ? 0 : 650, easing: easeInOutCubic });
    // insets are read when the request arrives, on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyKey, ready]);

  // HTML markers.
  useEffect(() => {
    const map = mapRef.current;
    const ml = mlRef.current;
    if (!map || !ml || !ready) return;
    const place = (key: string, pos: LonLat | null, make: () => HTMLElement, anchor: "bottom" | "center") => {
      const m = markers.current[key];
      if (!pos) {
        m?.remove();
        markers.current[key] = null;
        return;
      }
      if (m) m.setLngLat(pos);
      else markers.current[key] = new ml.Marker({ element: make(), anchor }).setLngLat(pos).addTo(map);
    };
    // A new destination drops in again; the same one only moves.
    const destKey = destination ? `${destination.point[0]},${destination.point[1]}|${destination.label}` : "";
    if (destKey !== destMarkerKey.current) {
      markers.current.destination?.remove();
      markers.current.destination = null;
      destMarkerKey.current = destKey;
    }
    place("destination", destination?.point ?? null, () => markerEl("destination", destination?.label ?? "Destination"), "bottom");
    place("origin", origin, () => markerEl("origin", "Start"), "center");
    place("me", userLocation, () => markerEl("me", "Your location"), "center");
    place("car", parkedCar, () => markerEl("car", "Your parked car"), "center");
  }, [destination, origin, userLocation, parkedCar, ready]);

  // Frame the content inside the unobstructed region when the frame key changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const h = handlers.current;
    const pts: LonLat[] = [...(h.framePoints ?? [])];
    const sel = h.routes.find((r) => r.selected) ?? h.routes[0];
    const focus = sel && h.focusLeg !== null && h.focusLeg !== undefined ? sel.option.legs[h.focusLeg] : undefined;
    if (focus && focus.geometry.length >= 2) pts.push(...focus.geometry);
    else if (sel) for (const leg of sel.option.legs) pts.push(...leg.geometry);
    if (!pts.length && h.stations.length) {
      for (const s of h.stations.slice(0, 6)) pts.push([s.lon, s.lat]);
      if (h.userLocation) pts.push(h.userLocation);
      else if (h.origin) pts.push(h.origin);
    }
    if (!pts.length && h.parking && h.bundle) {
      for (const p of h.bundle.parking) if (h.parking.visibleIds.has(p.id)) pts.push(p.center);
    }
    if (!pts.length && h.destination) {
      // Before routes arrive: both ends (the shared location counts as the start).
      if (h.origin) pts.push(h.origin);
      else if (h.userLocation) pts.push(h.userLocation);
      pts.push(h.destination.point);
    }
    if (pts.length === 1) {
      const c = pts[0]!;
      pts.push([c[0] - 0.003, c[1] - 0.002], [c[0] + 0.003, c[1] + 0.002]);
    }
    if (!pts.length && h.userLocation) {
      const c = h.userLocation;
      pts.push([c[0] - 0.006, c[1] - 0.004], [c[0] + 0.006, c[1] + 0.004]);
    }
    if (!pts.length && h.bundle) pts.push(...h.bundle.bounds);
    const b = boundsOf(pts);
    if (!b) return;
    // The sheet can cover most of a phone: shrink the padding rather than fail to frame.
    const canvas = map.getContainer();
    const pad = fitPadding({ top: insets.top + 24, bottom: insets.bottom + 24, left: insets.left + 24, right: insets.right + 64 }, canvas.clientWidth, canvas.clientHeight);
    const reduce = h.reducedMotion;
    try {
      // absolutePadding: the padding replaces the map's current padding. Without it MapLibre adds
      // it to the padding left by the previous camera move, counts the sheet twice and refuses to frame.
      // linear: an ease, not a fly-out-and-in, for these short moves.
      map.fitBounds(b as LngLatBoundsLike, { padding: pad, absolutePadding: true, linear: true, maxZoom: 17, duration: reduce ? 0 : 700, easing: easeInOutCubic, essential: true });
    } catch {
      map.jumpTo({ center: [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2] });
    }
    // insets are read at frame time on purpose; resizing the sheet should not move the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameKey, ready]);

  // Follow the person's location when it first arrives, and whenever they tap "Show my location".
  const lastMe = useRef<string>("");
  const wantCenter = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !userLocation) return;
    const k = userLocation.join(",");
    const asked = wantCenter.current;
    wantCenter.current = false;
    if (k === lastMe.current && !asked) return;
    lastMe.current = k;
    // Unasked, it never pulls the camera away from a route or stations already framed.
    const h = handlers.current;
    if (!asked && (h.routes.length || h.stations.length || h.destination)) return;
    const c = map.getContainer();
    map.easeTo({ center: userLocation, zoom: Math.max(map.getZoom(), 14.5), padding: fitPadding(insets, c.clientWidth, c.clientHeight), duration: props.reducedMotion ? 0 : 600, easing: easeInOutCubic });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userLocation, ready]);

  const zoom = (d: number) => mapRef.current?.easeTo({ zoom: (mapRef.current?.getZoom() ?? 12) + d, duration: props.reducedMotion ? 0 : 260 });
  const ctl = "pointer-events-auto grid h-11 w-11 place-items-center text-app-ink transition-colors hover:bg-app-chip active:bg-app-chip-hover";

  return (
    // The sheet sets --cm-sheet-cover here while it moves, so the controls and attribution follow it.
    <div className="absolute inset-0" data-follow-sheet style={{ "--cm-map-bottom": `${insets.bottom}px` } as React.CSSProperties}>
      <div ref={containerRef} className="h-full w-full" role="region" aria-label="Map. The panel lists the same information." />
      {failed ? <div className="absolute inset-0 grid place-items-center bg-app-bg p-6 text-center text-body text-app-muted">Map unavailable. Everything is in the panel.</div> : null}
      {picking ? (
        <div className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full" style={{ left: `calc(${insets.left}px + (100% - ${insets.left}px) / 2)`, top: `calc(${insets.top}px + (100% - ${insets.top}px - ${insets.bottom}px) / 2)` }} aria-hidden>
          <svg width="34" height="44" viewBox="0 0 34 44" style={{ filter: "drop-shadow(0 3px 4px rgba(7,17,31,.4))" }}>
            <path d="M17 43s15-14 15-25.5A15 15 0 0 0 2 17.5C2 29 17 43 17 43Z" fill="#07111F" stroke="#fff" strokeWidth="2" />
            <circle cx="17" cy="17.5" r="5.5" fill="#91F24D" />
          </svg>
        </div>
      ) : null}
      <div className="cm-follow pointer-events-none absolute right-3 z-10 flex flex-col items-end gap-2.5">
        {props.onToggleStyle ? (
          <button type="button" onClick={props.onToggleStyle} aria-label={theme === "dark" ? "Map style: dark. Switch to light map" : "Map style: light. Switch to dark map"} className={`${ctl} cm-glass rounded-full border border-app-line`}>
            <Layers className="h-5 w-5" aria-hidden />
          </button>
        ) : null}
        <div className="cm-glass pointer-events-auto flex flex-col overflow-hidden rounded-full border border-app-line">
          <button type="button" onClick={() => zoom(1)} aria-label="Zoom in" className={`${ctl} border-b border-app-line`}>
            <Plus className="h-5 w-5" aria-hidden />
          </button>
          <button type="button" onClick={() => zoom(-1)} aria-label="Zoom out" className={ctl}>
            <Minus className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <button
          type="button"
          onClick={() => {
            wantCenter.current = true;
            props.onLocate?.();
          }}
          aria-label="Show my location" aria-busy={props.locating || undefined} className={`${ctl} cm-glass rounded-full border border-app-line !text-app-route ${props.locating ? "animate-pulse" : ""}`}>
          <LocateFixed className="h-5 w-5" strokeWidth={2.2} aria-hidden />
        </button>
      </div>
    </div>
  );
}

function addLayers(map: MapLibreMap, dark: boolean) {
  if (map.getSource("cm-routes")) return;
  if (!map.hasImage("cm-hatch")) map.addImage("cm-hatch", hatchImage(dark));
  const surface = dark ? "#0D1929" : "#ffffff";
  const ink = dark ? "#F5F8FC" : "#07111F";
  // Route blue draws the selected route, teal its walking legs; lime marks the selected stop.
  const blue = dark ? "#42A5FF" : "#1D7FE0";
  const teal = dark ? "#30D5C8" : "#0B7A72";
  const lime = "#91F24D";
  for (const kind of ["rail", "bus"] as const) {
    map.addImage(`cm-${kind}`, iconImage(kind, surface, ink, dark ? "#2B3D55" : "#C3CEDB"), { pixelRatio: 2 });
    map.addImage(`cm-${kind}-on`, iconImage(kind, lime, "#07111F", dark ? surface : "#07111F"), { pixelRatio: 2 });
  }
  map.addSource("cm-building", { type: "geojson", data: EMPTY });
  map.addSource("cm-parking", { type: "geojson", data: EMPTY });
  map.addSource("cm-parking-pts", { type: "geojson", data: EMPTY, cluster: true, clusterMaxZoom: 14, clusterRadius: 36 });
  map.addSource("cm-routes", { type: "geojson", data: EMPTY });
  map.addSource("cm-stops", { type: "geojson", data: EMPTY });
  map.addSource("cm-stations", { type: "geojson", data: EMPTY });
  map.addSource("cm-reports", { type: "geojson", data: EMPTY });

  // Brand: a blue route over a navy (or white) casing; walking legs are teal dots.
  const casing = dark ? "#07111F" : "#ffffff";
  const route = blue;
  const alt = dark ? "#3B4D66" : "#A6B3C3";

  map.addLayer({ id: "cm-building-fill", type: "fill", source: "cm-building", paint: { "fill-color": ink, "fill-opacity": 0.12 } });
  // Solid outline when the entrance is mapped; dashed when the pin is only the building centre.
  map.addLayer({ id: "cm-building-line", type: "line", source: "cm-building", filter: ["==", ["get", "verified"], true], paint: { "line-color": ink, "line-width": 2 } });
  map.addLayer({ id: "cm-building-line-approx", type: "line", source: "cm-building", filter: ["==", ["get", "verified"], false], paint: { "line-color": ink, "line-width": 2, "line-dasharray": [2, 1.5] } });

  map.addLayer({ id: "cm-parking-hatch", type: "fill", source: "cm-parking", filter: ["==", ["get", "status"], "unknown"], paint: { "fill-pattern": "cm-hatch" } });
  map.addLayer({
    id: "cm-parking-fill",
    type: "fill",
    source: "cm-parking",
    paint: {
      "fill-color": PARKING_FILL,
      "fill-opacity": 0.08,
    },
  });
  const parkingLine = {
    "line-color": ["case", ["==", ["get", "selected"], 1], ink, ["match", ["get", "status"], "allowed", ELIG_LINE.allowed, "requires_action", ELIG_LINE.requires_action, "prohibited", ELIG_LINE.prohibited, ELIG_LINE.unknown]] as unknown as string,
    "line-width": ["case", ["==", ["get", "selected"], 1], 3.5, 2] as unknown as number,
  };
  // Not-allowed places get a dashed border so the status never depends on colour alone.
  map.addLayer({ id: "cm-parking-line", type: "line", source: "cm-parking", filter: ["!=", ["get", "status"], "prohibited"], paint: parkingLine });
  map.addLayer({ id: "cm-parking-line-no", type: "line", source: "cm-parking", filter: ["==", ["get", "status"], "prohibited"], paint: { ...parkingLine, "line-dasharray": [2, 1.5] } });
  map.addLayer({
    id: "cm-parking-pts",
    type: "circle",
    source: "cm-parking-pts",
    maxzoom: 15,
    paint: {
      "circle-radius": ["case", ["has", "point_count"], 14, 7] as unknown as number,
      "circle-color": ["case", ["has", "point_count"], ink, ["match", ["get", "status"], "allowed", ELIG_LINE.allowed, "requires_action", ELIG_LINE.requires_action, "prohibited", ELIG_LINE.prohibited, ELIG_LINE.unknown]] as unknown as string,
      "circle-stroke-color": casing,
      "circle-stroke-width": 2,
    },
  });
  map.addLayer({ id: "cm-parking-count", type: "symbol", source: "cm-parking-pts", filter: ["has", "point_count"], maxzoom: 15, layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": FONT, "text-size": 12 }, paint: { "text-color": casing } });
  map.addLayer({
    id: "cm-parking-label",
    type: "symbol",
    source: "cm-parking-pts",
    minzoom: 15,
    filter: ["!", ["has", "point_count"]],
    layout: { "text-field": ["get", "code"], "text-font": FONT, "text-size": 12, "text-allow-overlap": false },
    paint: { "text-color": ink, "text-halo-color": casing, "text-halo-width": 1.5 },
  });

  // Alternatives (subdued), then the selected route: casing, then mode styles.
  const round = { "line-cap": "round", "line-join": "round" } as const;
  map.addLayer({ id: "cm-route-alt-casing", type: "line", source: "cm-routes", filter: ["==", ["get", "selected"], 0], layout: round, paint: { "line-color": casing, "line-width": 7, "line-opacity": 0.9 } });
  map.addLayer({ id: "cm-route-alt", type: "line", source: "cm-routes", filter: ["==", ["get", "selected"], 0], layout: round, paint: { "line-color": alt, "line-width": 4 } });
  // A soft glow under the selected route lifts it off the basemap.
  map.addLayer({
    id: "cm-route-glow",
    type: "line",
    source: "cm-routes",
    filter: ["==", ["get", "selected"], 1],
    layout: round,
    paint: { "line-color": ["case", ["==", ["get", "color"], ""], blue, ["get", "color"]] as unknown as string, "line-width": dark ? 16 : 14, "line-opacity": dark ? 0.22 : 0.25, "line-blur": dark ? 8 : 4 },
  });
  map.addLayer({ id: "cm-route-casing", type: "line", source: "cm-routes", filter: ["all", ["==", ["get", "selected"], 1], ["!=", ["get", "kind"], "walk"]], layout: round, paint: { "line-color": casing, "line-width": 10 } });
  map.addLayer({ id: "cm-route-drive", type: "line", source: "cm-routes", filter: ["all", ["==", ["get", "selected"], 1], ["==", ["get", "kind"], "drive"]], layout: round, paint: { "line-color": route, "line-width": 6 } });
  map.addLayer({
    id: "cm-route-ride",
    type: "line",
    source: "cm-routes",
    filter: ["all", ["==", ["get", "selected"], 1], ["==", ["get", "kind"], "ride"]],
    layout: round,
    paint: { "line-color": ["case", ["==", ["get", "color"], ""], route, ["get", "color"]] as unknown as string, "line-width": 6 },
  });
  map.addLayer({ id: "cm-route-walk", type: "line", source: "cm-routes", filter: ["all", ["==", ["get", "selected"], 1], ["==", ["get", "kind"], "walk"]], layout: round, paint: { "line-color": teal, "line-width": 4.5, "line-dasharray": [0.1, 1.8] } });
  map.addLayer({ id: "cm-route-hit", type: "line", source: "cm-routes", filter: ["==", ["get", "selected"], 0], paint: { "line-color": "#000", "line-opacity": 0, "line-width": 18 } });

  map.addLayer({
    id: "cm-stops",
    type: "circle",
    source: "cm-stops",
    paint: {
      "circle-radius": ["match", ["get", "role"], "transfer", 6, 7.5] as unknown as number,
      "circle-color": casing,
      "circle-stroke-color": ["case", ["==", ["get", "color"], ""], route, ["get", "color"]] as unknown as string,
      "circle-stroke-width": 3.5,
    },
  });
  map.addLayer({ id: "cm-stops-label", type: "symbol", source: "cm-stops", minzoom: 13, layout: { "text-field": ["get", "name"], "text-font": FONT, "text-size": 12, "text-offset": [0, 1.3], "text-anchor": "top", "text-max-width": 10 }, paint: { "text-color": ink, "text-halo-color": casing, "text-halo-width": 1.5 } });

  map.addLayer({
    id: "cm-stations",
    type: "symbol",
    source: "cm-stations",
    layout: { "icon-image": ["get", "icon"] as unknown as string, "icon-allow-overlap": true, "symbol-sort-key": ["get", "selected"] as unknown as number, "icon-size": ["case", ["==", ["get", "selected"], 1], 1.15, 1] as unknown as number },
  });
  // Labels for rail stations and the selected stop only, so bus-stop names don't pile up.
  map.addLayer({ id: "cm-stations-label", type: "symbol", source: "cm-stations", minzoom: 13, filter: ["any", ["==", ["get", "kind"], "rail"], ["==", ["get", "selected"], 1]], layout: { "text-field": ["get", "name"], "text-font": FONT, "text-size": 12, "text-offset": [0, 1.5], "text-anchor": "top", "text-max-width": 10, "text-optional": true }, paint: { "text-color": ink, "text-halo-color": casing, "text-halo-width": 1.5 } });

  // Community reports: amber for an open barrier (larger once others confirmed it), grey once
  // people reported it fixed; the selected one gets a lime ring.
  const amber = dark ? "#FFB547" : "#C27400";
  map.addLayer({
    id: "cm-reports",
    type: "circle",
    source: "cm-reports",
    paint: {
      "circle-radius": ["case", ["==", ["get", "selected"], 1], 10, ["==", ["get", "confirmed"], 1], 8, 6.5] as unknown as number,
      "circle-color": ["match", ["get", "status"], "fixed", dark ? "#6B7C93" : "#8A97A8", amber] as unknown as string,
      "circle-stroke-color": ["case", ["==", ["get", "selected"], 1], lime, casing] as unknown as string,
      "circle-stroke-width": ["case", ["==", ["get", "selected"], 1], 3.5, 2] as unknown as number,
    },
  });
}
