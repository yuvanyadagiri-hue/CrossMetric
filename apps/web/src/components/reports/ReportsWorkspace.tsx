"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GeoJSONSource, Map as MapLibreMap, MapLayerMouseEvent, Marker } from "maplibre-gl";
import { CheckCircle2, MapPin, MessageSquareWarning, Plus, ThumbsUp, Wrench, X } from "lucide-react";
import { loadMapLibre } from "@/components/map/loadMapLibre";
import { BASEMAP_STYLE } from "@/components/map/mapTheme";
import { PlaceCombobox } from "@/components/search/PlaceCombobox";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Status";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/States";
import { categoryLabel, DESCRIPTION_MAX, REPORT_CATEGORIES, reportStatus, timeAgo, verificationLevel, type CommunityReport, type ReportCategory } from "@/lib/reports";
import type { LonLat } from "@/lib/trip-types";
import { isGeorgiaPoint } from "@/lib/trip-types";

type StatusFilter = "open" | "reported-fixed" | "all";

const VOTED_KEY = "crossmetric:report-votes:v1";
function readVotes(): Record<string, "confirm" | "fixed"> {
  try {
    return JSON.parse(window.localStorage.getItem(VOTED_KEY) ?? "{}") as Record<string, "confirm" | "fixed">;
  } catch {
    return {};
  }
}

export function ReportsWorkspace({ initialNew, initialAt }: { initialNew: boolean; initialAt: LonLat | null }) {
  const [reports, setReports] = useState<CommunityReport[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [category, setCategory] = useState<ReportCategory | "all">("all");
  const [status, setStatus] = useState<StatusFilter>("open");
  const [selected, setSelected] = useState<string | null>(null);
  const [composing, setComposing] = useState(initialNew);
  const [pin, setPin] = useState<LonLat | null>(initialAt);
  const [votes, setVotes] = useState<Record<string, "confirm" | "fixed">>({});

  const load = useCallback(() => {
    fetch("/api/reports")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((b: { reports: CommunityReport[] }) => setReports(b.reports))
      .catch(() => setLoadError(true));
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      load();
      setVotes(readVotes());
    }, 0);
    return () => clearTimeout(t);
  }, [load]);

  const visible = useMemo(
    () => (reports ?? []).filter((r) => (category === "all" || r.category === category) && (status === "all" || reportStatus(r) === status)),
    [reports, category, status],
  );

  const vote = async (id: string, kind: "confirm" | "fixed") => {
    const res = await fetch(`/api/reports/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ vote: kind }) });
    if (!res.ok) return;
    const { report } = (await res.json()) as { report: CommunityReport };
    setReports((rs) => (rs ?? []).map((r) => (r.id === id ? report : r)));
    const next = { ...readVotes(), [id]: kind };
    try {
      window.localStorage.setItem(VOTED_KEY, JSON.stringify(next));
    } catch {
      // Storage unavailable: the vote still counted on the server.
    }
    setVotes(next);
  };

  return (
    <div className="grid flex-1 grid-cols-1 lg:h-[calc(100dvh-64px)] lg:flex-none lg:grid-cols-[440px_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col border-r border-line bg-white" aria-label="Community reports">
        <div className="border-b border-line p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-component font-semibold text-navy-900">Community reports</h1>
              <p className="mt-0.5 text-small leading-snug text-ink-muted">Walking and biking issues flagged by people who travel these streets. Anonymous, and never treated as official data.</p>
            </div>
            {!composing ? (
              <Button size="sm" icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setComposing(true)}>
                Report
              </Button>
            ) : null}
          </div>
          {!composing ? (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label>
                <span className="sr-only">Category</span>
                <select className="select !py-1.5 !text-[13px]" value={category} onChange={(e) => setCategory(e.target.value as ReportCategory | "all")}>
                  <option value="all">All categories</option>
                  {REPORT_CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="sr-only">Status</span>
                <select className="select !py-1.5 !text-[13px]" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
                  <option value="open">Open</option>
                  <option value="reported-fixed">Reported fixed</option>
                  <option value="all">All statuses</option>
                </select>
              </label>
            </div>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
          {composing ? (
            <ReportForm
              pin={pin}
              onPin={setPin}
              onCancel={() => setComposing(false)}
              onCreated={(r) => {
                setReports((rs) => [r, ...(rs ?? [])]);
                setComposing(false);
                setPin(null);
                setSelected(r.id);
                setStatus("open");
              }}
            />
          ) : loadError ? (
            <div className="p-4">
              <ErrorState title="Reports could not be loaded" action={<Button size="sm" variant="secondary" onClick={() => (setLoadError(false), load())}>Try again</Button>} />
            </div>
          ) : !reports ? (
            <ul className="space-y-3 p-4" aria-busy="true" aria-label="Loading reports">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-[72px]" />
              ))}
            </ul>
          ) : visible.length === 0 ? (
            <EmptyState
              icon={<MessageSquareWarning className="h-5 w-5" />}
              title={reports.length ? "No reports match these filters" : "No community reports yet"}
              action={
                <Button size="sm" variant="secondary" onClick={() => setComposing(true)}>
                  Report an issue
                </Button>
              }
            >
              {reports.length ? "Try another category or status." : "Flag a missing sidewalk, a difficult crossing or a blocked path so others can plan around it."}
            </EmptyState>
          ) : (
            <ul className="divide-y divide-line" aria-label={`${visible.length} reports`}>
              {visible.map((r) => {
                const fixed = reportStatus(r) === "reported-fixed";
                const voted = votes[r.id];
                return (
                  <li key={r.id} className={`p-4 transition-colors ${selected === r.id ? "bg-brand-50/60" : ""}`}>
                    <button type="button" onClick={() => setSelected(r.id)} className="w-full text-left">
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-small font-semibold text-navy-900">{categoryLabel(r.category)}</span>
                        <span className="tabular shrink-0 text-meta text-ink-muted">{timeAgo(r.createdAt)}</span>
                      </span>
                      {r.locationLabel ? <span className="mt-0.5 block text-meta text-ink-muted">{r.locationLabel}</span> : null}
                      {r.description ? <span className="mt-1.5 block text-small leading-relaxed text-ink-soft">{r.description}</span> : null}
                    </button>
                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                      {fixed ? (
                        <Badge tone="positive">Reported fixed</Badge>
                      ) : verificationLevel(r) === "community-confirmed" ? (
                        <Badge tone="info">Confirmed by {r.confirmations} people</Badge>
                      ) : (
                        <Badge tone="neutral" icon={false}>
                          Unverified
                        </Badge>
                      )}
                      <span className="flex-1" />
                      <button
                        type="button"
                        disabled={!!voted}
                        onClick={() => vote(r.id, "confirm")}
                        className="btn-quiet !text-[12.5px] disabled:opacity-50"
                        aria-label={`I see this too (${r.confirmations})`}
                      >
                        <ThumbsUp className="h-3.5 w-3.5" aria-hidden /> {voted === "confirm" ? "Thanks" : "I see this too"} · {r.confirmations}
                      </button>
                      <button type="button" disabled={!!voted} onClick={() => vote(r.id, "fixed")} className="btn-quiet !text-[12.5px] disabled:opacity-50">
                        <Wrench className="h-3.5 w-3.5" aria-hidden /> {voted === "fixed" ? "Thanks" : "It's fixed"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <p className="border-t border-line px-4 py-2.5 text-meta leading-relaxed text-ink-muted">
          Reports and votes are anonymous and are not verified by CrossMetric or any agency. To request repairs, contact your city, county or GDOT.
        </p>
      </aside>
      <section className="relative h-[60vh] min-h-[380px] lg:h-auto" aria-label="Reports map">
        <ReportsMap reports={visible} selected={selected} onSelect={setSelected} composing={composing} pin={pin} onPin={setPin} />
      </section>
    </div>
  );
}

function ReportForm({ pin, onPin, onCancel, onCreated }: { pin: LonLat | null; onPin: (p: LonLat) => void; onCancel: () => void; onCreated: (r: CommunityReport) => void }) {
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [description, setDescription] = useState("");
  const [label, setLabel] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pin) return;
    const c = new AbortController();
    fetch("/api/places/reverse", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lon: pin[0], lat: pin[1] }), signal: c.signal })
      .then((r) => r.json())
      .then((b: { label?: string | null }) => setLabel(b.label ?? null))
      .catch(() => undefined);
    return () => c.abort();
  }, [pin]);

  const submit = async () => {
    if (!category) return setError("Choose what kind of issue this is.");
    if (!pin) return setError("Place the pin on the map where the issue is.");
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ category, description: description.trim() || null, lon: pin[0], lat: pin[1], locationLabel: label }),
      });
      const body = (await res.json()) as { report?: CommunityReport; error?: string };
      if (!res.ok || !body.report) throw new Error(body.error ?? "The report could not be saved.");
      onCreated(body.report);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      className="space-y-5 p-4 animate-[var(--animate-fade-in)]"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      aria-label="Report an issue"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-body font-semibold text-navy-900">Report an issue</h2>
        <button type="button" onClick={onCancel} className="btn-quiet" aria-label="Cancel report">
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <fieldset>
        <legend className="mb-2 text-small font-semibold text-navy-900">1. What is the issue?</legend>
        <div className="flex flex-wrap gap-2">
          {REPORT_CATEGORIES.map((c) => (
            <label
              key={c.id}
              className={`cursor-pointer rounded-full px-3 py-1.5 text-small font-medium ring-1 ring-inset transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand-500 ${
                category === c.id ? "bg-navy-900 text-white ring-navy-900" : "bg-white text-ink-soft ring-line-strong hover:text-navy-900"
              }`}
            >
              <input type="radio" name="category" value={c.id} className="sr-only" checked={category === c.id} onChange={() => setCategory(c.id)} />
              {c.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <p className="mb-2 text-small font-semibold text-navy-900">2. Where is it?</p>
        <PlaceCombobox label="Find a street or place" value={null} onSelect={(p) => onPin([p.lon, p.lat])} placeholder="Search, then fine-tune on the map" />
        <p className="mt-2 flex items-center gap-1.5 text-meta text-ink-muted">
          <MapPin className="h-3.5 w-3.5" aria-hidden />
          {pin ? (label ? `Pin near ${label}` : `Pin at ${pin[1].toFixed(5)}, ${pin[0].toFixed(5)}`) : "Click the map to place a pin, then drag it to the exact spot."}
        </p>
      </div>
      <div>
        <label htmlFor="report-description" className="mb-2 block text-small font-semibold text-navy-900">
          3. Details <span className="font-normal text-ink-muted">(optional)</span>
        </label>
        <textarea
          id="report-description"
          className="input min-h-[96px] resize-y"
          maxLength={DESCRIPTION_MAX}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. Sidewalk ends at the bus stop; people walk in the road."
          aria-describedby="report-description-help"
        />
        <p id="report-description-help" className="mt-1 flex justify-between text-meta text-ink-muted">
          <span>Don&rsquo;t include names, phone numbers or emails.</span>
          <span className="tabular">
            {description.length}/{DESCRIPTION_MAX}
          </span>
        </p>
      </div>
      {error ? (
        <p role="alert" className="text-small font-medium text-critical-fg">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" loading={submitting} icon={<CheckCircle2 className="h-4 w-4" aria-hidden />}>
          Submit report
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function ReportsMap({
  reports,
  selected,
  onSelect,
  composing,
  pin,
  onPin,
}: {
  reports: CommunityReport[];
  selected: string | null;
  onSelect: (id: string) => void;
  composing: boolean;
  pin: LonLat | null;
  onPin: (p: LonLat) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const pinRef = useRef<Marker | null>(null);
  const mlRef = useRef<typeof import("maplibre-gl") | null>(null);
  const handlers = useRef({ onSelect, onPin, composing });
  useEffect(() => {
    handlers.current = { onSelect, onPin, composing };
  }, [onSelect, onPin, composing]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let map: MapLibreMap | null = null;
    let cancelled = false;
    (async () => {
      const ml = await loadMapLibre();
      if (cancelled || !ref.current) return;
      mlRef.current = ml;
      map = new ml.Map({ container: ref.current, style: BASEMAP_STYLE, center: [-84.39, 33.76], zoom: 11, attributionControl: { compact: true } });
      mapRef.current = map;
      map.addControl(new ml.NavigationControl({ showCompass: false }), "bottom-right");
      map.on("load", () => {
        if (!map) return;
        map.addSource("reports", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({
          id: "reports",
          type: "circle",
          source: "reports",
          paint: {
            "circle-radius": ["case", ["boolean", ["get", "selected"], false], 9, 6.5],
            "circle-color": ["case", ["==", ["get", "fixed"], 1], "#12a46f", "#f0a020"],
            "circle-stroke-color": ["case", ["boolean", ["get", "selected"], false], "#15191E", "#ffffff"],
            "circle-stroke-width": ["case", ["boolean", ["get", "selected"], false], 3, 2],
          },
        });
        map.on("click", "reports", (e: MapLayerMouseEvent) => {
          if (handlers.current.composing) return;
          const id = (e.features?.[0]?.properties as { id?: string } | undefined)?.id;
          if (id) handlers.current.onSelect(id);
        });
        map.on("mouseenter", "reports", () => map && (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", "reports", () => map && (map.getCanvas().style.cursor = ""));
        map.on("click", (e) => {
          if (!handlers.current.composing) return;
          const p: LonLat = [e.lngLat.lng, e.lngLat.lat];
          if (isGeorgiaPoint(p[0], p[1])) handlers.current.onPin(p);
        });
        setReady(true);
      });
    })();
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource("reports") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: reports.map((r) => ({ type: "Feature", properties: { id: r.id, fixed: reportStatus(r) === "reported-fixed" ? 1 : 0, selected: r.id === selected }, geometry: { type: "Point", coordinates: [r.lon, r.lat] } })),
    } as never);
  }, [ready, reports, selected]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !selected) return;
    const r = reports.find((x) => x.id === selected);
    if (r) map.easeTo({ center: [r.lon, r.lat], zoom: Math.max(map.getZoom(), 15), duration: 600 });
  }, [ready, selected, reports]);

  useEffect(() => {
    const map = mapRef.current;
    const ml = mlRef.current;
    if (!ready || !map || !ml) return;
    if (!composing || !pin) {
      pinRef.current?.remove();
      pinRef.current = null;
      return;
    }
    if (!pinRef.current) {
      const el = document.createElement("div");
      el.setAttribute("aria-label", "Report location (drag to adjust)");
      el.innerHTML =
        '<svg width="30" height="38" viewBox="0 0 34 42" aria-hidden="true"><path d="M17 41s14-13.2 14-24A14 14 0 0 0 3 17c0 10.8 14 24 14 24Z" fill="#f0a020" stroke="#fff" stroke-width="2"/><circle cx="17" cy="17" r="5" fill="#fff"/></svg>';
      pinRef.current = new ml.Marker({ element: el, anchor: "bottom", draggable: true }).setLngLat(pin).addTo(map);
      pinRef.current.on("dragend", () => {
        const ll = pinRef.current!.getLngLat();
        handlers.current.onPin([ll.lng, ll.lat]);
      });
    } else {
      pinRef.current.setLngLat(pin);
    }
    map.easeTo({ center: pin, zoom: Math.max(map.getZoom(), 16), duration: 500 });
  }, [ready, composing, pin]);

  return (
    <div className="relative h-full w-full">
      <div ref={ref} className="h-full w-full" role="region" aria-label="Map of community reports. The list beside the map has the same reports." />
      {composing ? (
        <p className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-navy-900 px-3.5 py-1.5 text-meta font-medium text-white shadow-[var(--shadow-float)]">
          {pin ? "Drag the pin to the exact spot" : "Click the map where the issue is"}
        </p>
      ) : null}
    </div>
  );
}
