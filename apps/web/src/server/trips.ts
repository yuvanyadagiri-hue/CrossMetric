import "server-only";

import { computeCrossScore, curbReasons, routeOverlap, scoreCurb, selectRoutes, CROSSSCORE_MODEL } from "@crossmetric/engine";
import type { CurbConditions, TravelMode } from "@crossmetric/engine";
import type { CurbOption, CurbResult, LonLat, ModeComparison, ModeSummary, Place, PlannedRoute, TripResult } from "@/lib/trip-types";
import { crashesNear, measureRoute, roadAt, squareAround } from "./route-analysis";
import { getStatewide, settingAt } from "./statewide";
import { getTransit, nearestStops } from "./transit";
import { locate, route, RoutingError, traceAttributes, walkingDistances, type ValhallaEdge, type ValhallaRoute } from "./valhalla";

/** Mode-specific preferences for the "infrastructure" alternative (Valhalla costing options). */
const INFRASTRUCTURE_OPTIONS: Partial<Record<TravelMode, Record<string, number | string>>> = {
  walk: { walkway_factor: 0.6, sidewalk_factor: 0.6, alley_factor: 3, driveway_factor: 6, use_lit: 0.5 },
  bike: { use_roads: 0.1, bicycle_type: "Hybrid", avoid_bad_surfaces: 0.5, use_living_streets: 0.8 },
};

const MAX_ROUTES = 4;
const HOTSPOT_AVOID_M = 35;

interface Candidate {
  route: ValhallaRoute;
  strategy: PlannedRoute["strategy"];
}

function densify(shape: LonLat[], stepDeg = 0.0002): LonLat[] {
  const out: LonLat[] = [];
  for (let i = 1; i < shape.length; i++) {
    const [ax, ay] = shape[i - 1]!;
    const [bx, by] = shape[i]!;
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / stepDeg));
    for (let k = 0; k < n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  const last = shape[shape.length - 1];
  if (last) out.push(last);
  return out;
}

function round6(shape: LonLat[]): LonLat[] {
  return shape.map(([x, y]) => [Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6]);
}

async function safely<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof RoutingError && err.kind === "no_route") return null;
    throw err;
  }
}

async function edgesFor(mode: TravelMode, shape: LonLat[]): Promise<ValhallaEdge[] | null> {
  try {
    return (await traceAttributes(mode, shape)).edges;
  } catch {
    return null;
  }
}

export async function planTrip(from: Place, to: Place, mode: TravelMode): Promise<TripResult> {
  const sw = await getStatewide();
  const fromLL: LonLat = [from.lon, from.lat];
  const toLL: LonLat = [to.lon, to.lat];

  const base = await route({ mode, from: fromLL, to: toLL, alternates: 2 });
  if (!base.length) throw new RoutingError("No route found.", "no_route");
  const candidates: Candidate[] = base.map((r, i) => ({ route: r, strategy: i === 0 ? "default" : "alternate" }));

  const infra = INFRASTRUCTURE_OPTIONS[mode];
  const first = base[0]!;
  const probe = measureRoute(sw, mode, first.shape, first.durationS, null);
  const [infraRoutes, avoidRoutes] = await Promise.all([
    infra ? safely(route({ mode, from: fromLL, to: toLL, options: infra })) : Promise.resolve(null),
    probe.avoidPoints.length
      ? safely(route({ mode, from: fromLL, to: toLL, exclude: probe.avoidPoints.map((p) => squareAround(p, HOTSPOT_AVOID_M)) }))
      : Promise.resolve(null),
  ]);
  for (const r of infraRoutes ?? []) candidates.push({ route: r, strategy: "infrastructure" });
  for (const r of avoidRoutes ?? []) candidates.push({ route: r, strategy: "avoid-hotspots" });

  // Drop near-duplicates (same streets) so every option shown is a real alternative.
  const distinct: (Candidate & { dense: LonLat[] })[] = [];
  for (const c of candidates) {
    const dense = densify(c.route.shape);
    if (distinct.some((d) => routeOverlap(d.dense, dense) > CROSSSCORE_MODEL.selection.distinctOverlapMax)) continue;
    distinct.push({ ...c, dense });
    if (distinct.length >= MAX_ROUTES) break;
  }

  const edges = await Promise.all(distinct.map((c) => edgesFor(mode, c.route.shape)));
  const notes: string[] = [];
  if (edges.some((e) => e === null)) notes.push("Sidewalk, bike-lane and speed-limit data could not be loaded for every route; those factors are left out where missing.");

  const scored = distinct.map((c, i) => {
    const m = measureRoute(sw, mode, c.route.shape, c.route.durationS, edges[i] ?? null);
    const crossScore = computeCrossScore(m.conditions, sw.manifest.references);
    return { id: `r${i + 1}`, c, m, crossScore };
  });
  const selection = selectRoutes(scored.map((s) => ({ id: s.id, durationS: s.c.route.durationS, score: s.crossScore.score })));
  const routes: PlannedRoute[] = selection.options.map((opt) => {
    const s = scored.find((x) => x.id === opt.id)!;
    return {
      id: s.id,
      roles: opt.roles,
      mode,
      lengthM: Math.round(s.c.route.lengthM),
      durationS: Math.round(s.c.route.durationS),
      geometry: round6(s.c.route.shape),
      crossScore: s.crossScore,
      segments: s.m.segments.map((seg) => ({ ...seg, coords: round6(seg.coords) })),
      hotspots: s.m.hotspots,
      via: s.m.via,
      strategy: s.c.strategy,
      lowLightCrashes: s.m.lowLightCrashes,
    };
  });
  if (routes.length === 1) notes.push("Only one practical route was found, so it is the safest, balanced and fastest option.");
  return { from, to, mode, routes, notes, dataWindow: sw.manifest.window, generatedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// Mode comparison
// ---------------------------------------------------------------------------

async function scoredDefault(mode: TravelMode, from: LonLat, to: LonLat) {
  const sw = await getStatewide();
  const routes = await safely(route({ mode, from, to }));
  const r = routes?.[0];
  if (!r) return null;
  const edges = await edgesFor(mode, r.shape);
  const m = measureRoute(sw, mode, r.shape, r.durationS, edges);
  return { route: r, score: computeCrossScore(m.conditions, sw.manifest.references) };
}

const MODE_SUMMARY: Record<TravelMode, (score: number) => string> = {
  walk: (s) => (s >= 75 ? "Fewer risk indicators for walking" : s >= 50 ? "Mixed walking conditions" : "Several walking risk indicators"),
  bike: (s) => (s >= 75 ? "Fewer risk indicators for biking" : s >= 50 ? "Mixed biking conditions" : "Several biking risk indicators"),
  drive: (s) => (s >= 75 ? "Fewer crash indicators on the drive" : s >= 50 ? "Mixed driving conditions" : "Busy, crash-heavy roads"),
};

export async function compareModes(from: Place, to: Place): Promise<ModeComparison> {
  const fromLL: LonLat = [from.lon, from.lat];
  const toLL: LonLat = [to.lon, to.lat];
  const [walk, bike, drive, t] = await Promise.all([
    scoredDefault("walk", fromLL, toLL),
    scoredDefault("bike", fromLL, toLL),
    scoredDefault("drive", fromLL, toLL),
    getTransit().catch(() => null),
  ]);
  const summary = (mode: "walk" | "bike" | "drive", r: Awaited<ReturnType<typeof scoredDefault>>): ModeSummary =>
    r
      ? { mode, available: true, lengthM: Math.round(r.route.lengthM), durationS: Math.round(r.route.durationS), score: r.score.score, band: r.score.band, summary: MODE_SUMMARY[mode](r.score.score) }
      : { mode, available: false, summary: "No route", unavailableReason: `No ${mode === "walk" ? "walking" : mode === "bike" ? "bike" : "driving"} route could be calculated for this trip.` };

  const modes: ModeSummary[] = [summary("walk", walk), summary("bike", bike)];

  // Transit: CrossMetric shows real nearby stops, but does not compute schedules.
  if (t) {
    const near = (p: LonLat) => nearestStops(t, p, 800, 3);
    const a = near(fromLL);
    const b = near(toLL);
    if (a.length && b.length) {
      const walks = await walkingDistances(fromLL, a.map(({ i }) => [t.stops.lon[i]!, t.stops.lat[i]!] as LonLat)).catch(() => a.map(({ d }) => d * 1.25));
      modes.push({
        mode: "transit",
        available: true,
        summary: "MARTA stops near both ends",
        unavailableReason: "CrossMetric shows nearby stops but does not calculate transit schedules or a CrossScore for riding.",
        nearbyStops: a.map(({ i, d }, k) => ({ name: t.stops.name[i]!, routes: t.stops.routes[i]!, rail: t.stops.rail[i]!, walkM: Math.round(walks[k] ?? d * 1.25) })),
      });
    } else {
      modes.push({ mode: "transit", available: false, summary: "No nearby stops", unavailableReason: "No MARTA stop within 800 m of both the start and the destination. Other Georgia transit agencies are not included yet." });
    }
  } else {
    modes.push({ mode: "transit", available: false, summary: "Unavailable", unavailableReason: "Transit stop data is not loaded." });
  }

  const driveSummary = summary("drive", drive);
  modes.push(driveSummary);
  modes.push({ ...driveSummary, mode: "rideshare", summary: driveSummary.available ? "Same streets as driving; choose a safer pickup point" : driveSummary.summary });
  if (to.kind === "school") {
    modes.push({ mode: "schoolBus", available: false, summary: "Ask the district", unavailableReason: "School bus routes are not published as public data, so CrossMetric cannot score them." });
  } else if (to.kind === "college") {
    modes.push({ mode: "shuttle", available: false, summary: "Check the campus", unavailableReason: "Campus shuttle routes are not available as public data." });
  }
  return { from, to, modes, generatedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// Safer pickup / drop-off
// ---------------------------------------------------------------------------

function offset([lon, lat]: LonLat, bearingDeg: number, m: number): LonLat {
  const b = (bearingDeg * Math.PI) / 180;
  const dLat = (m * Math.cos(b)) / 111_195;
  const dLon = (m * Math.sin(b)) / (111_195 * Math.cos((lat * Math.PI) / 180));
  return [lon + dLon, lat + dLat];
}

export async function curbOptions(around: Place, purpose: "pickup" | "dropoff"): Promise<CurbResult> {
  const sw = await getStatewide();
  const center: LonLat = [around.lon, around.lat];
  const probes: LonLat[] = [center];
  for (const m of [70, 150]) for (let b = 0; b < 360; b += 45) probes.push(offset(center, b + (m === 150 ? 22.5 : 0), m));
  const located = await locate(probes);
  const points: { lon: number; lat: number; street: string; lanes: number | null; speedKph: number | null }[] = [];
  for (const l of located) {
    if (!l || !["road", "living_street", "service_road"].includes(l.use)) continue;
    if (points.some((p) => Math.hypot((p.lon - l.lon) * 92_000, (p.lat - l.lat) * 111_195) < 30)) continue;
    points.push({ lon: l.lon, lat: l.lat, street: l.names[0] ?? "Unnamed street", lanes: l.laneCount, speedKph: l.speedLimitKph });
  }
  if (!points.length) return { purpose, around, options: [], recommendedId: null, generatedAt: new Date().toISOString() };
  const walks = await walkingDistances(center, points.map((p) => [p.lon, p.lat] as LonLat)).catch(() => points.map(() => null));
  const conditions: (CurbConditions & { lon: number; lat: number; street: string })[] = [];
  points.forEach((p, i) => {
    const walkM = walks[i];
    if (walkM === null || walkM === undefined || walkM > CROSSSCORE_MODEL.curb.maxWalkM) return;
    const gdot = roadAt(sw, [p.lon, p.lat]);
    conditions.push({
      id: `c${i}`,
      lon: p.lon,
      lat: p.lat,
      street: p.street,
      walkM: Math.round(walkM),
      context: settingAt(sw, p.lon, p.lat),
      crashes: crashesNear(sw, [p.lon, p.lat], CROSSSCORE_MODEL.curb.nearbyM),
      lanes: gdot?.lanes ?? null,
      aadt: gdot?.aadt ?? null,
      speedMph: p.speedKph === null ? null : Math.round((p.speedKph * 0.621371) / 5) * 5,
      localStreet: gdot === null,
    });
  });
  if (!conditions.length) return { purpose, around, options: [], recommendedId: null, generatedAt: new Date().toISOString() };
  const current = [...conditions].sort((a, b) => a.walkM - b.walkM)[0]!;
  const scored = conditions.map((c) => ({ c, s: scoreCurb(c, sw.manifest.references) }));
  const currentScore = scored.find((x) => x.c.id === current.id)!.s.score;
  const alternatives = scored.filter((x) => x.c.id !== current.id).sort((a, b) => b.s.score - a.s.score || a.c.walkM - b.c.walkM).slice(0, 3);
  const best = alternatives[0];
  const recommendedId = best && best.s.score >= currentScore + CROSSSCORE_MODEL.curb.minImprovement ? best.c.id : null;
  const toOption = (x: (typeof scored)[number], isCurrent: boolean): CurbOption => ({
    id: x.c.id,
    lon: x.c.lon,
    lat: x.c.lat,
    street: x.c.street,
    walkM: x.c.walkM,
    current: isCurrent,
    score: x.s,
    reasons: isCurrent ? [] : curbReasons(current, x.c),
  });
  return {
    purpose,
    around,
    options: [toOption(scored.find((x) => x.c.id === current.id)!, true), ...alternatives.map((x) => toOption(x, false))],
    recommendedId,
    generatedAt: new Date().toISOString(),
  };
}
