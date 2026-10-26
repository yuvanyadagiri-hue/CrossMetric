"use client";

import { useEffect, useRef, useState } from "react";
import type { GeoJSONSource, Map as MapLibreMap, MapLayerMouseEvent, Popup } from "maplibre-gl";
import type { AnalysisResult, SchoolPackage } from "@crossmetric/engine";
import { candidateFeatures, circleFeature, circleRing, boundsOfRing, crashFeatures, geometryBounds } from "@/lib/geojson";
import { loadMapLibre } from "./loadMapLibre";
import { BASEMAP_STYLE, bandColorExpression, NAVY, schoolMarkerElement } from "./mapTheme";

interface Props {
  pkg: SchoolPackage;
  result: AnalysisResult;
  selectedId: string | null;
  comparedIds: string[];
  hoveredId: string | null;
  showCrashes: boolean;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}

const CANDIDATE_LAYERS = ["cm-segments", "cm-intersections"];

export function AnalysisMap({ pkg, result, selectedId, comparedIds, hoveredId, showCrashes, onSelect, onHover }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const popupRef = useRef<Popup | null>(null);
  const handlers = useRef({ onSelect, onHover });
  useEffect(() => {
    handlers.current = { onSelect, onHover };
  }, [onSelect, onHover]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  // 1. Create the map once per school.
  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | null = null;
    (async () => {
      const maplibre = await loadMapLibre();
      if (cancelled || !containerRef.current) return;
      const ring = circleRing(pkg.school.lon, pkg.school.lat, 1200);
      map = new maplibre.Map({
        container: containerRef.current,
        style: BASEMAP_STYLE,
        bounds: boundsOfRing(ring),
        fitBoundsOptions: { padding: 40 },
        attributionControl: { compact: true },
        cooperativeGestures: false,
      });
      mapRef.current = map;
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), "bottom-right");
      map.addControl(new maplibre.ScaleControl({ unit: "imperial", maxWidth: 100 }), "bottom-left");
      popupRef.current = new maplibre.Popup({ closeButton: false, closeOnClick: false, offset: 10, className: "cm-popup" });
      new maplibre.Marker({ element: schoolMarkerElement(`${pkg.school.name} (school location)`) })
        .setLngLat([pkg.school.lon, pkg.school.lat])
        .addTo(map);

      map.on("error", (e) => {
        // Basemap tiles failing must not hide the analysis layers.
        if (String(e.error?.message ?? "").includes("style")) setFailed(true);
      });

      map.on("load", () => {
        if (!map) return;
        const firstLabel = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
        const empty = { type: "FeatureCollection" as const, features: [] };
        map.addSource("cm-radius", { type: "geojson", data: empty });
        map.addSource("cm-crashes", { type: "geojson", data: empty });
        map.addSource("cm-candidates", { type: "geojson", data: empty, promoteId: "id" });

        map.addLayer({ id: "cm-radius-fill", type: "fill", source: "cm-radius", paint: { "fill-color": "#23744A", "fill-opacity": 0.045 } }, firstLabel);
        map.addLayer(
          { id: "cm-radius-line", type: "line", source: "cm-radius", paint: { "line-color": NAVY, "line-width": 1.4, "line-opacity": 0.55, "line-dasharray": [3, 2.5] } },
          firstLabel,
        );
        map.addLayer(
          {
            id: "cm-crashes",
            type: "circle",
            source: "cm-crashes",
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 13, 1.6, 17, 3.6],
              "circle-color": ["case", ["==", ["get", "pedestrian"], 1], "#7c3aed", NAVY],
              "circle-opacity": 0.42,
            },
          },
          firstLabel,
        );
        map.addLayer(
          {
            id: "cm-segments-selected",
            type: "line",
            source: "cm-candidates",
            filter: ["==", ["get", "id"], ""],
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": NAVY, "line-width": ["interpolate", ["linear"], ["zoom"], 13, 9, 17, 16] },
          },
          firstLabel,
        );
        map.addLayer(
          {
            id: "cm-segments",
            type: "line",
            source: "cm-candidates",
            filter: ["==", ["geometry-type"], "LineString"],
            layout: { "line-cap": "round", "line-join": "round", "line-sort-key": ["get", "order"] },
            paint: {
              "line-color": bandColorExpression,
              "line-width": ["interpolate", ["linear"], ["zoom"], 13, 3.5, 17, 9],
              "line-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 1, ["==", ["get", "band"], "lower"], 0.7, 0.92],
            },
          },
          firstLabel,
        );
        map.addLayer({
          id: "cm-intersections",
          type: "circle",
          source: "cm-candidates",
          filter: ["==", ["geometry-type"], "Point"],
          layout: { "circle-sort-key": ["get", "order"] },
          paint: {
            "circle-color": bandColorExpression,
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 13, ["match", ["get", "band"], "lower", 3.5, 5.5], 17, ["match", ["get", "band"], "lower", 7, 11]],
            "circle-stroke-color": ["case", ["boolean", ["feature-state", "compared"], false], NAVY, "#ffffff"],
            "circle-stroke-width": ["case", ["boolean", ["feature-state", "compared"], false], 2.5, 1.6],
          },
        });
        map.addLayer({
          id: "cm-intersections-selected",
          type: "circle",
          source: "cm-candidates",
          filter: ["==", ["get", "id"], ""],
          paint: {
            "circle-color": "rgba(0,0,0,0)",
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 13, 10, 17, 17],
            "circle-stroke-color": NAVY,
            "circle-stroke-width": 3,
          },
        });
        map.addLayer({
          id: "cm-rank-labels",
          type: "symbol",
          source: "cm-candidates",
          filter: ["<=", ["get", "rank"], 5],
          layout: {
            "text-field": ["to-string", ["get", "rank"]],
            "text-font": ["Noto Sans Bold"],
            "text-size": 11,
            "text-offset": [0, -1.35],
            "text-allow-overlap": true,
            "symbol-placement": "point",
          },
          paint: { "text-color": NAVY, "text-halo-color": "#ffffff", "text-halo-width": 1.6 },
        });

        let hovered: string | null = null;
        const setHover = (id: string | null) => {
          if (hovered) map?.setFeatureState({ source: "cm-candidates", id: hovered }, { hover: false });
          hovered = id;
          if (id) map?.setFeatureState({ source: "cm-candidates", id }, { hover: true });
        };
        for (const layer of CANDIDATE_LAYERS) {
          map.on("mousemove", layer, (e: MapLayerMouseEvent) => {
            const f = e.features?.[0];
            if (!f || !map) return;
            map.getCanvas().style.cursor = "pointer";
            const p = f.properties as { id: string; name: string; rank: number; priority: number };
            setHover(p.id);
            handlers.current.onHover(p.id);
            popupRef.current
              ?.setLngLat(e.lngLat)
              .setHTML(`<div style="font:500 12px var(--font-sans);color:#16202e"><div style="font-weight:600">${escapeHtml(p.name)}</div><div style="color:#667085;margin-top:2px">#${p.rank} · Priority ${p.priority}</div></div>`)
              .addTo(map);
          });
          map.on("mouseleave", layer, () => {
            if (!map) return;
            map.getCanvas().style.cursor = "";
            setHover(null);
            handlers.current.onHover(null);
            popupRef.current?.remove();
          });
          map.on("click", layer, (e: MapLayerMouseEvent) => {
            const id = (e.features?.[0]?.properties as { id?: string } | undefined)?.id;
            if (id) handlers.current.onSelect(id);
          });
        }
        setReady(true);
      });
    })().catch(() => setFailed(true));
    return () => {
      cancelled = true;
      popupRef.current?.remove();
      map?.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, [pkg.school.id, pkg.school.lat, pkg.school.lon, pkg.school.name]);

  // Side panels opening/closing change the map's container size.
  useEffect(() => {
    const el = containerRef.current;
    if (!ready || !el) return;
    const ro = new ResizeObserver(() => mapRef.current?.resize());
    ro.observe(el);
    return () => ro.disconnect();
  }, [ready]);

  // 2. Push analysis data whenever the analysis changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource("cm-candidates") as GeoJSONSource).setData(candidateFeatures(result) as never);
    (map.getSource("cm-crashes") as GeoJSONSource).setData(crashFeatures(pkg, result) as never);
    (map.getSource("cm-radius") as GeoJSONSource).setData(circleFeature(pkg.school.lon, pkg.school.lat, result.config.radiusM) as never);
  }, [ready, result, pkg]);

  // 3. Fit to the analysis radius when it changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const ring = circleRing(pkg.school.lon, pkg.school.lat, result.config.radiusM);
    map.fitBounds(boundsOfRing(ring), { padding: 36, duration: 600 });
  }, [ready, result.config.radiusM, pkg.school.lat, pkg.school.lon]);

  // 4. Selection, comparison and hover highlighting.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const id = selectedId ?? "";
    map.setFilter("cm-segments-selected", ["all", ["==", ["get", "id"], id], ["==", ["geometry-type"], "LineString"]]);
    map.setFilter("cm-intersections-selected", ["all", ["==", ["get", "id"], id], ["==", ["geometry-type"], "Point"]]);
  }, [ready, selectedId, result]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    for (const s of result.candidates) {
      map.setFeatureState({ source: "cm-candidates", id: s.candidate.id }, { compared: comparedIds.includes(s.candidate.id) });
    }
  }, [ready, comparedIds, result]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    for (const s of result.candidates) map.setFeatureState({ source: "cm-candidates", id: s.candidate.id }, { hover: s.candidate.id === hoveredId });
  }, [ready, hoveredId, result]);

  // 5. Bring the selected candidate into view if it is off-screen.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !selectedId) return;
    const s = result.candidates.find((c) => c.candidate.id === selectedId);
    if (!s) return;
    const [[minX, minY], [maxX, maxY]] = geometryBounds(s.candidate.geometry);
    const view = map.getBounds();
    const inView = view.contains([minX, minY]) && view.contains([maxX, maxY]);
    if (!inView) map.easeTo({ center: [(minX + maxX) / 2, (minY + maxY) / 2], duration: 500 });
  }, [ready, selectedId, result]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.setLayoutProperty("cm-crashes", "visibility", showCrashes ? "visible" : "none");
  }, [ready, showCrashes]);

  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        className="h-full w-full"
        role="region"
        aria-label={`Map of ${result.population} candidate locations within ${result.config.radiusM} meters of ${pkg.school.name}. The ranked list provides the same information for keyboard and screen-reader users.`}
      />
      {!ready && !failed ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-canvas/60">
          <span className="text-small text-ink-muted">Loading map…</span>
        </div>
      ) : null}
      {failed ? (
        <div className="absolute inset-x-4 top-4 rounded-md border border-line bg-white px-3 py-2 text-meta text-ink-soft shadow">
          The basemap could not be loaded. Rankings, evidence and the list below are unaffected.
        </div>
      ) : null}
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string);
}
