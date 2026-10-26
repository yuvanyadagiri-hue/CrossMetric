import "server-only";

import type { TravelMode } from "@crossmetric/engine";

/**
 * Client for a Valhalla routing service (OpenStreetMap road network).
 *
 * Default: the public FOSSGIS instance (valhalla1.openstreetmap.de), which is
 * free for fair, low-volume use. Set VALHALLA_URL to a self-hosted instance
 * for heavier use. Requests go out from the CrossMetric server, so a visitor's
 * IP address is never sent to the routing service; responses are cached.
 */

export type LonLat = [number, number];

export interface ValhallaRoute {
  shape: LonLat[];
  lengthM: number;
  durationS: number;
}

export interface ValhallaEdge {
  lengthM: number;
  beginShapeIndex: number;
  endShapeIndex: number;
  names: string[];
  use: string;
  roadClass: string;
  sidewalk: string;
  cycleLane: string;
  speedLimitKph: number | null;
  laneCount: number | null;
  trafficSignalAtEnd: boolean;
}

export interface LocatedEdge {
  lon: number;
  lat: number;
  names: string[];
  roadClass: string;
  use: string;
  laneCount: number | null;
  speedLimitKph: number | null;
  sidewalk: boolean;
  distanceM: number;
}

export class RoutingError extends Error {
  constructor(
    message: string,
    readonly kind: "no_route" | "unavailable",
  ) {
    super(message);
  }
}

const BASE = (process.env.VALHALLA_URL ?? "https://valhalla1.openstreetmap.de").replace(/\/$/, "");
const USER_AGENT = "CrossMetric/2.0 (Congressional App Challenge student project)";
const TIMEOUT_MS = 15_000;
const MAX_CONCURRENT = 3;
const CACHE_MAX = 400;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export const COSTING: Record<TravelMode, string> = { walk: "pedestrian", bike: "bicycle", drive: "auto" };

// ---------------------------------------------------------------------------
// Small LRU cache + concurrency limiter
// ---------------------------------------------------------------------------

const cache = new Map<string, { at: number; value: Promise<unknown> }>();

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    cache.delete(key);
    cache.set(key, hit);
    return hit.value as Promise<T>;
  }
  const value = load();
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.delete(key));
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  return value;
}

let active = 0;
const waiting: (() => void)[] = [];

async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

async function post<T>(endpoint: string, body: unknown): Promise<T> {
  return limited(async () => {
    let res: Response;
    try {
      res = await fetch(`${BASE}/${endpoint}`, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": USER_AGENT },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
    } catch {
      throw new RoutingError("The routing service did not respond.", "unavailable");
    }
    const json = (await res.json().catch(() => null)) as (T & { error?: string; error_code?: number }) | null;
    if (!res.ok || !json) {
      // Valhalla 4xx with error codes 170-172/442/171 means no path between the points.
      const code = json?.error_code ?? 0;
      if (res.status === 400 && [170, 171, 172, 442, 443].includes(code)) throw new RoutingError(json?.error ?? "No route found.", "no_route");
      throw new RoutingError(`Routing service error (${res.status}).`, "unavailable");
    }
    return json;
  });
}

// ---------------------------------------------------------------------------
// Polyline (precision 6) decoding
// ---------------------------------------------------------------------------

export function decodePolyline6(encoded: string): LonLat[] {
  const out: LonLat[] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  while (index < encoded.length) {
    for (const which of [0, 1]) {
      let result = 0;
      let shift = 0;
      let b: number;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += delta;
      else lon += delta;
    }
    out.push([lon / 1e6, lat / 1e6]);
  }
  return out;
}

function encodePolyline6(points: LonLat[]): string {
  let out = "";
  let pLat = 0;
  let pLon = 0;
  const enc = (v: number) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    while (n >= 0x20) {
      out += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    out += String.fromCharCode(n + 63);
  };
  for (const [lon, lat] of points) {
    const iLat = Math.round(lat * 1e6);
    const iLon = Math.round(lon * 1e6);
    enc(iLat - pLat);
    enc(iLon - pLon);
    pLat = iLat;
    pLon = iLon;
  }
  return out;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export interface RouteRequest {
  mode: TravelMode;
  from: LonLat;
  to: LonLat;
  /** Mode-specific costing options (e.g. prefer sidewalks or bike paths). */
  options?: Record<string, number | string | boolean>;
  /** Small polygons the route must avoid (used to route around crash hotspots). */
  exclude?: LonLat[][];
  alternates?: number;
}

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

export function route(req: RouteRequest): Promise<ValhallaRoute[]> {
  const costing = COSTING[req.mode];
  const body: Record<string, unknown> = {
    locations: [
      { lon: r6(req.from[0]), lat: r6(req.from[1]) },
      { lon: r6(req.to[0]), lat: r6(req.to[1]) },
    ],
    costing,
    units: "kilometers",
    directions_type: "none",
    shape_format: "polyline6",
  };
  if (req.options) body.costing_options = { [costing]: req.options };
  if (req.exclude?.length) body.exclude_polygons = req.exclude;
  if (req.alternates) body.alternates = req.alternates;
  const key = `route:${JSON.stringify(body)}`;
  return cached(key, async () => {
    type Trip = { trip: { summary: { length: number; time: number }; legs: { shape: string }[] } };
    const json = await post<Trip & { alternates?: Trip[] }>("route", body);
    const trips = [json, ...(json.alternates ?? [])];
    return trips.map((t) => ({
      shape: t.trip.legs.flatMap((leg, i) => {
        const pts = decodePolyline6(leg.shape);
        return i === 0 ? pts : pts.slice(1);
      }),
      lengthM: t.trip.summary.length * 1000,
      durationS: t.trip.summary.time,
    }));
  });
}

const EDGE_ATTRIBUTES = [
  "edge.length",
  "edge.names",
  "edge.use",
  "edge.road_class",
  "edge.sidewalk",
  "edge.cycle_lane",
  "edge.speed_limit",
  "edge.lane_count",
  "edge.begin_shape_index",
  "edge.end_shape_index",
  "node.traffic_signal",
];

/** OpenStreetMap attributes of every edge a route uses (sidewalks, bike lanes, posted speeds). */
export function traceAttributes(mode: TravelMode, shape: LonLat[]): Promise<{ edges: ValhallaEdge[]; shape: LonLat[] }> {
  const body = {
    encoded_polyline: encodePolyline6(shape),
    shape_match: "edge_walk",
    costing: COSTING[mode],
    filters: { attributes: [...EDGE_ATTRIBUTES, "shape"], action: "include" },
  };
  return cached(`trace:${mode}:${body.encoded_polyline}`, async () => {
    type Raw = {
      shape?: string;
      edges: {
        length?: number;
        names?: string[];
        use?: string;
        road_class?: string;
        sidewalk?: string;
        cycle_lane?: string;
        speed_limit?: number;
        lane_count?: number;
        begin_shape_index?: number;
        end_shape_index?: number;
        end_node?: { traffic_signal?: boolean };
      }[];
    };
    const json = await post<Raw>("trace_attributes", body);
    return {
      shape: json.shape ? decodePolyline6(json.shape) : shape,
      edges: json.edges.map((e) => ({
        lengthM: (e.length ?? 0) * 1000,
        beginShapeIndex: e.begin_shape_index ?? 0,
        endShapeIndex: e.end_shape_index ?? 0,
        names: e.names ?? [],
        use: e.use ?? "road",
        roadClass: e.road_class ?? "",
        sidewalk: e.sidewalk ?? "none",
        cycleLane: e.cycle_lane ?? "none",
        speedLimitKph: typeof e.speed_limit === "number" && e.speed_limit > 0 && e.speed_limit < 200 ? e.speed_limit : null,
        laneCount: typeof e.lane_count === "number" && e.lane_count > 0 ? e.lane_count : null,
        trafficSignalAtEnd: e.end_node?.traffic_signal === true,
      })),
    };
  });
}

/** Snap points to the nearest street a car can stop on (for pickup and drop-off). */
export function locate(points: LonLat[]): Promise<(LocatedEdge | null)[]> {
  const body = { locations: points.map(([lon, lat]) => ({ lon: r6(lon), lat: r6(lat) })), costing: "auto", verbose: true };
  return cached(`locate:${JSON.stringify(body.locations)}`, async () => {
    type Raw = {
      edges?: {
        correlated_lat: number;
        correlated_lon: number;
        distance: number;
        edge_info?: { names?: string[]; speed_limit?: number };
        edge?: { lane_count?: number; sidewalk_left?: boolean; sidewalk_right?: boolean; classification?: { classification?: string; use?: string } };
      }[];
    }[];
    const json = await post<Raw>("locate", body);
    return json.map((loc) => {
      const e = loc.edges?.[0];
      if (!e) return null;
      const limit = e.edge_info?.speed_limit;
      return {
        lon: e.correlated_lon,
        lat: e.correlated_lat,
        names: e.edge_info?.names ?? [],
        roadClass: e.edge?.classification?.classification ?? "",
        use: e.edge?.classification?.use ?? "road",
        laneCount: e.edge?.lane_count ?? null,
        speedLimitKph: typeof limit === "number" && limit > 0 && limit < 200 ? limit : null,
        sidewalk: !!(e.edge?.sidewalk_left || e.edge?.sidewalk_right),
        distanceM: e.distance,
      };
    });
  });
}

/** Walking distances (meters) from one origin to several targets. */
export function walkingDistances(from: LonLat, targets: LonLat[]): Promise<(number | null)[]> {
  const body = {
    sources: [{ lon: r6(from[0]), lat: r6(from[1]) }],
    targets: targets.map(([lon, lat]) => ({ lon: r6(lon), lat: r6(lat) })),
    costing: "pedestrian",
    units: "kilometers",
  };
  return cached(`matrix:${JSON.stringify(body)}`, async () => {
    type Raw = { sources_to_targets: { distance: number | null }[][] };
    const json = await post<Raw>("sources_to_targets", body);
    return (json.sources_to_targets[0] ?? []).map((c) => (c.distance === null ? null : c.distance * 1000));
  });
}

export interface MatrixCell {
  meters: number | null;
  seconds: number | null;
}

/** Travel time and distance from each source to each target. */
export function matrix(mode: TravelMode, sources: LonLat[], targets: LonLat[], options?: Record<string, number | string | boolean>): Promise<MatrixCell[][]> {
  const costing = COSTING[mode];
  const body: Record<string, unknown> = {
    sources: sources.map(([lon, lat]) => ({ lon: r6(lon), lat: r6(lat) })),
    targets: targets.map(([lon, lat]) => ({ lon: r6(lon), lat: r6(lat) })),
    costing,
    units: "kilometers",
  };
  if (options) body.costing_options = { [costing]: options };
  return cached(`matrix2:${JSON.stringify(body)}`, async () => {
    type Raw = { sources_to_targets: { distance: number | null; time: number | null }[][] };
    const json = await post<Raw>("sources_to_targets", body);
    return json.sources_to_targets.map((row) => row.map((c) => ({ meters: c.distance === null ? null : c.distance * 1000, seconds: c.time })));
  });
}

export interface Maneuver {
  instruction: string;
  lengthM: number;
  timeS: number;
  beginShapeIndex: number;
}

/** One route with turn-by-turn maneuvers (used for walking guidance). */
export function routeWithSteps(mode: TravelMode, from: LonLat, to: LonLat, options?: Record<string, number | string | boolean>): Promise<ValhallaRoute & { maneuvers: Maneuver[] }> {
  const costing = COSTING[mode];
  const body: Record<string, unknown> = {
    locations: [
      { lon: r6(from[0]), lat: r6(from[1]) },
      { lon: r6(to[0]), lat: r6(to[1]) },
    ],
    costing,
    units: "kilometers",
    directions_type: "instructions",
    shape_format: "polyline6",
  };
  if (options) body.costing_options = { [costing]: options };
  return cached(`steps:${JSON.stringify(body)}`, async () => {
    type Raw = { trip: { summary: { length: number; time: number }; legs: { shape: string; maneuvers?: { instruction: string; length: number; time: number; begin_shape_index: number }[] }[] } };
    const json = await post<Raw>("route", body);
    const leg = json.trip.legs[0]!;
    return {
      shape: decodePolyline6(leg.shape),
      lengthM: json.trip.summary.length * 1000,
      durationS: json.trip.summary.time,
      maneuvers: (leg.maneuvers ?? []).map((m) => ({ instruction: m.instruction, lengthM: m.length * 1000, timeS: m.time, beginShapeIndex: m.begin_shape_index })),
    };
  });
}
