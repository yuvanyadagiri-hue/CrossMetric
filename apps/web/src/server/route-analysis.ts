import "server-only";

import type { ContextId, CrashCounts, CrashPart, DensityReference, RouteConditions, TravelMode } from "@crossmetric/engine";
import type { Hotspot, LonLat, RouteSegment, SegmentLevel } from "@/lib/trip-types";
import { CRASH_CELL, CRASH_FLAG_LIMITED_ACCESS, ROAD_CELL, ROLE, settingAt, type Statewide } from "./statewide";
import type { ValhallaEdge } from "./valhalla";

/**
 * Measure a route against CrossMetric's statewide data:
 *   - GDOT crashes within 30 m of the route (same tolerance as the school analysis)
 *   - GDOT road class, lanes and AADT of the roads the route runs along
 *   - crossings of arterials / 4+ lane roads, and GDOT signals at those crossings
 *   - OpenStreetMap sidewalks, bike facilities and posted speeds (when available)
 */

const EARTH_R = 6_371_008.8;
const MATCH_M = 20; // a route point within 20 m of a centerline, running parallel, is "along" that road
const PARALLEL_COS = Math.cos((35 * Math.PI) / 180);
const SIGNAL_M = 45;
const CROSSING_MERGE_M = 45;
const CROSSING_PROBE_M = 25;
const MPH_PER_KPH = 0.621371;

const FLAG = { injury: 1, fatal: 2, pedestrian: 4, bicyclist: 8 } as const;

interface Projector {
  x: (lon: number) => number;
  y: (lat: number) => number;
  mx: number;
  my: number;
}

function projector(lon0: number, lat0: number): Projector {
  const mx = ((EARTH_R * Math.PI) / 180) * Math.cos((lat0 * Math.PI) / 180);
  const my = (EARTH_R * Math.PI) / 180;
  return { x: (lon) => (lon - lon0) * mx, y: (lat) => (lat - lat0) * my, mx, my };
}

function segDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): { d: number; t: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return { d: Math.hypot(ax + t * dx - px, ay + t * dy - py), t };
}

function segIntersect(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): number | null {
  const rX = bx - ax;
  const rY = by - ay;
  const sX = dx - cx;
  const sY = dy - cy;
  const denom = rX * sY - rY * sX;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((cx - ax) * sY - (cy - ay) * sX) / denom;
  const u = ((cx - ax) * rY - (cy - ay) * rX) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}

export interface RouteMeasurement {
  conditions: RouteConditions;
  segments: RouteSegment[];
  hotspots: Hotspot[];
  via: string[];
  /** Points (lon/lat) of the worst crash clusters, for hotspot-avoiding alternatives. */
  avoidPoints: LonLat[];
  /** Counted crashes that happened at dawn, dusk or in the dark. */
  lowLightCrashes: number;
}

interface Sample {
  lon: number;
  lat: number;
  x: number;
  y: number;
  s: number;
  w: number;
  hx: number;
  hy: number;
  piece: number; // matched GDOT piece running along, or -1
  context: ContextId;
}

interface NearCrash {
  idx: number;
  s: number;
  freeway: boolean;
}

function emptyCounts(): CrashCounts {
  return { all: 0, injury: 0, fatal: 0, pedestrian: 0, bicyclist: 0 };
}

function addCrash(c: CrashCounts, flags: number) {
  c.all++;
  if (flags & FLAG.injury) c.injury++;
  if (flags & FLAG.fatal) c.fatal++;
  if (flags & FLAG.pedestrian) c.pedestrian++;
  if (flags & FLAG.bicyclist) c.bicyclist++;
}

export function measureRoute(sw: Statewide, mode: TravelMode, shape: LonLat[], durationS: number, edges: ValhallaEdge[] | null): RouteMeasurement {
  const ref: DensityReference = sw.manifest.references;
  const buffer = sw.manifest.references.bufferM;
  const mid = shape[Math.floor(shape.length / 2)] ?? shape[0]!;
  const P = projector(mid[0], mid[1]);
  const xs = shape.map(([lon]) => P.x(lon));
  const ys = shape.map(([, lat]) => P.y(lat));
  const cum: number[] = [0];
  for (let i = 1; i < shape.length; i++) cum.push(cum[i - 1]! + Math.hypot(xs[i]! - xs[i - 1]!, ys[i]! - ys[i - 1]!));
  const lengthM = cum[cum.length - 1] ?? 0;

  const pointAt = (s: number): { x: number; y: number; lon: number; lat: number } => {
    const target = Math.max(0, Math.min(lengthM, s));
    let lo = 0;
    let hi = cum.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (cum[m]! <= target) lo = m;
      else hi = m;
    }
    const seg = cum[hi]! - cum[lo]!;
    const t = seg > 0 ? (target - cum[lo]!) / seg : 0;
    const x = xs[lo]! + (xs[hi]! - xs[lo]!) * t;
    const y = ys[lo]! + (ys[hi]! - ys[lo]!) * t;
    return { x, y, lon: mid[0] + x / P.mx, lat: mid[1] + y / P.my };
  };

  // ---- samples along the route, matched to GDOT major roads running parallel
  const spacing = Math.max(10, lengthM / 1500);
  const samples: Sample[] = [];
  for (let i = 1; i < shape.length; i++) {
    const len = cum[i]! - cum[i - 1]!;
    if (len <= 0) continue;
    const n = Math.max(1, Math.ceil(len / spacing));
    const hx = (xs[i]! - xs[i - 1]!) / len;
    const hy = (ys[i]! - ys[i - 1]!) / len;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const x = xs[i - 1]! + (xs[i]! - xs[i - 1]!) * t;
      const y = ys[i - 1]! + (ys[i]! - ys[i - 1]!) * t;
      samples.push({ x, y, lon: mid[0] + x / P.mx, lat: mid[1] + y / P.my, s: cum[i - 1]! + len * t, w: len / n, hx, hy, piece: -1, context: "quiet" });
    }
  }

  const roads = sw.roads;
  const piecesNear = (lon: number, lat: number): Set<number> => {
    const out = new Set<number>();
    const gx = Math.floor((lon + 180) / ROAD_CELL);
    const gy = Math.floor((lat + 90) / ROAD_CELL);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const p of roads.cells.get((gx + dx) * 1_000_000 + gy + dy) ?? []) out.add(p);
    return out;
  };

  let cachedKey = NaN;
  let cachedPieces = new Set<number>();
  for (const smp of samples) {
    const key = Math.floor((smp.lon + 180) / ROAD_CELL) * 1_000_000 + Math.floor((smp.lat + 90) / ROAD_CELL);
    if (key !== cachedKey) {
      cachedKey = key;
      cachedPieces = piecesNear(smp.lon, smp.lat);
    }
    let best = -1;
    let bestD = MATCH_M;
    for (const p of cachedPieces) {
      const start = roads.vOffset[p]!;
      const end = start + roads.vCount[p]!;
      for (let v = start + 1; v < end; v++) {
        const ax = P.x(roads.lon[v - 1]!);
        const ay = P.y(roads.lat[v - 1]!);
        const bx = P.x(roads.lon[v]!);
        const by = P.y(roads.lat[v]!);
        const { d } = segDistance(smp.x, smp.y, ax, ay, bx, by);
        if (d >= bestD) continue;
        const sl = Math.hypot(bx - ax, by - ay);
        if (sl <= 0) continue;
        const cos = Math.abs(((bx - ax) * smp.hx + (by - ay) * smp.hy) / sl);
        if (cos < PARALLEL_COS) continue;
        bestD = d;
        best = p;
      }
    }
    smp.piece = best;
    smp.context = best >= 0 && roads.role[best] === ROLE.accessControlled ? "freeway" : settingAt(sw, smp.lon, smp.lat);
  }

  const sampleIndexAt = (s: number): number => {
    let lo = 0;
    let hi = samples.length - 1;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (samples[m]!.s < s) lo = m + 1;
      else hi = m;
    }
    return lo;
  };
  const contextAt = (s: number): ContextId => samples[sampleIndexAt(s)]?.context ?? "quiet";
  const onFreeway = (s: number): boolean => contextAt(s) === "freeway";

  // ---- crashes within the buffer
  const crashes = sw.crashes;
  const found = new Map<number, number>(); // crash index -> s
  const foundD = new Map<number, number>();
  const padLon = buffer / P.mx;
  const padLat = buffer / P.my;
  for (let i = 1; i < shape.length; i++) {
    const [aLon, aLat] = shape[i - 1]!;
    const [bLon, bLat] = shape[i]!;
    const gx0 = Math.floor((Math.min(aLon, bLon) - padLon + 180) / CRASH_CELL);
    const gx1 = Math.floor((Math.max(aLon, bLon) + padLon + 180) / CRASH_CELL);
    const gy0 = Math.floor((Math.min(aLat, bLat) - padLat + 90) / CRASH_CELL);
    const gy1 = Math.floor((Math.max(aLat, bLat) + padLat + 90) / CRASH_CELL);
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gy = gy0; gy <= gy1; gy++) {
        const range = crashes.cells.get(gx * 1_000_000 + gy);
        if (!range) continue;
        for (let k = range[0]; k < range[1]; k++) {
          const c = crashes.order[k]!;
          const { d, t } = segDistance(P.x(crashes.lon[c]!), P.y(crashes.lat[c]!), xs[i - 1]!, ys[i - 1]!, xs[i]!, ys[i]!);
          if (d > buffer) continue;
          const prev = foundD.get(c);
          if (prev !== undefined && prev <= d) continue;
          foundD.set(c, d);
          found.set(c, cum[i - 1]! + (cum[i]! - cum[i - 1]!) * t);
        }
      }
    }
  }
  const parts = new Map<ContextId, CrashPart>();
  const part = (context: ContextId): CrashPart => {
    let p = parts.get(context);
    if (!p) {
      p = { context, meters: 0, counts: emptyCounts() };
      parts.set(context, p);
    }
    return p;
  };
  for (const smp of samples) part(smp.context).meters += smp.w;
  const near: NearCrash[] = [];
  let lowLightCrashes = 0;
  for (const [c, s] of found) {
    const flags = crashes.flags[c]!;
    const limited = (flags & CRASH_FLAG_LIMITED_ACCESS) !== 0;
    const fw = onFreeway(s);
    // A freeway crash only counts when the route is on the freeway, and vice versa
    // (a street passing under an interstate does not inherit the interstate's crashes).
    if (limited !== fw) continue;
    addCrash(part(contextAt(s)).counts, flags);
    if (flags & 16) lowLightCrashes++;
    near.push({ idx: c, s, freeway: fw });
  }
  near.sort((a, b) => a.s - b.s);

  // ---- GDOT attributes along the route
  let surfaceM = 0;
  let freewayM = 0;
  const lanes = { upTo2M: 0, threeM: 0, fourOrFiveM: 0, sixPlusM: 0 };
  const volume = { localM: 0, below9000M: 0, below12000M: 0, below15000M: 0, below30000M: 0, atLeast30000M: 0, unknownM: 0 };
  for (const smp of samples) {
    const p = smp.piece;
    if (p >= 0 && roads.role[p] === ROLE.accessControlled) {
      freewayM += smp.w;
      continue;
    }
    surfaceM += smp.w;
    if (p < 0) {
      lanes.upTo2M += smp.w;
      volume.localM += smp.w;
      continue;
    }
    const l = roads.lanes[p]!;
    if (l <= 2) lanes.upTo2M += smp.w;
    else if (l === 3) lanes.threeM += smp.w;
    else if (l <= 5) lanes.fourOrFiveM += smp.w;
    else lanes.sixPlusM += smp.w;
    const a = roads.aadt[p]!;
    if (a === 0) volume.unknownM += smp.w;
    else if (a < 9000) volume.below9000M += smp.w;
    else if (a < 12000) volume.below12000M += smp.w;
    else if (a < 15000) volume.below15000M += smp.w;
    else if (a < 30000) volume.below30000M += smp.w;
    else volume.atLeast30000M += smp.w;
  }

  // ---- OpenStreetMap infrastructure per edge
  const edgeSpans: { s0: number; s1: number; e: ValhallaEdge }[] = [];
  let speed: RouteConditions["speed"] = null;
  let walkFacilities: RouteConditions["walkFacilities"] = null;
  let bikeFacilities: RouteConditions["bikeFacilities"] = null;
  if (edges && edges.length) {
    const total = edges.reduce((s, e) => s + e.lengthM, 0) || 1;
    const scale = lengthM / total;
    let s = 0;
    speed = { roadwayM: 0, taggedM: 0, mphMeters: 0 };
    walkFacilities = { recordedM: 0, totalM: 0 };
    bikeFacilities = { separatedM: 0, pathM: 0, dedicatedM: 0, sharedM: 0, noneM: 0 };
    for (const e of edges) {
      const len = e.lengthM * scale;
      edgeSpans.push({ s0: s, s1: s + len, e });
      s += len;
      const footpath = ["sidewalk", "footway", "path", "pedestrian", "steps", "pedestrian_crossing", "elevator", "platform", "cycleway"].includes(e.use);
      const roadway = !footpath && !["ferry", "rail", "rail-ferry"].includes(e.use);
      if (roadway) {
        speed.roadwayM += len;
        if (e.speedLimitKph !== null) {
          speed.taggedM += len;
          speed.mphMeters += e.speedLimitKph * MPH_PER_KPH * len;
        }
      }
      walkFacilities.totalM += len;
      if (footpath || ["left", "right", "both"].includes(e.sidewalk)) walkFacilities.recordedM += len;
      if (e.cycleLane === "separated" || e.use === "cycleway") bikeFacilities.separatedM += len;
      else if (footpath) bikeFacilities.pathM += len;
      else if (e.cycleLane === "dedicated") bikeFacilities.dedicatedM += len;
      else if (e.cycleLane === "shared") bikeFacilities.sharedM += len;
      else bikeFacilities.noneM += len;
    }
  }
  /** Street names at a distance along the route, or of the nearest named edge within 150 m (footpaths are often unnamed). */
  const namesAt = (s: number): string[] => {
    let best: string[] = [];
    let bestD = 150;
    for (const sp of edgeSpans) {
      if (!sp.e.names.length) continue;
      const d = s < sp.s0 ? sp.s0 - s : s > sp.s1 ? s - sp.s1 : 0;
      if (d < bestD) {
        bestD = d;
        best = sp.e.names;
        if (d === 0) break;
      }
    }
    return best;
  };
  const signalNodeNear = (s: number): boolean => edgeSpans.some((sp) => sp.e.trafficSignalAtEnd && Math.abs(sp.s1 - s) <= 30);

  // ---- crossings of arterials / 4+ lane roads
  const isMajor = (p: number) => roads.role[p] === ROLE.surface && (roads.fSystem[p]! <= 4 || roads.lanes[p]! >= 4);
  const hits: { s: number; piece: number; x: number; y: number; ax: number; ay: number; bx: number; by: number }[] = [];
  for (let i = 1; i < shape.length; i++) {
    const [aLon, aLat] = shape[i - 1]!;
    const [bLon, bLat] = shape[i]!;
    const cand = new Set<number>();
    for (let gx = Math.floor((Math.min(aLon, bLon) + 180) / ROAD_CELL); gx <= Math.floor((Math.max(aLon, bLon) + 180) / ROAD_CELL); gx++) {
      for (let gy = Math.floor((Math.min(aLat, bLat) + 90) / ROAD_CELL); gy <= Math.floor((Math.max(aLat, bLat) + 90) / ROAD_CELL); gy++) {
        for (const p of roads.cells.get(gx * 1_000_000 + gy) ?? []) if (isMajor(p)) cand.add(p);
      }
    }
    for (const p of cand) {
      const start = roads.vOffset[p]!;
      const end = start + roads.vCount[p]!;
      for (let v = start + 1; v < end; v++) {
        const cx = P.x(roads.lon[v - 1]!);
        const cy = P.y(roads.lat[v - 1]!);
        const dx = P.x(roads.lon[v]!);
        const dy = P.y(roads.lat[v]!);
        const t = segIntersect(xs[i - 1]!, ys[i - 1]!, xs[i]!, ys[i]!, cx, cy, dx, dy);
        if (t === null) continue;
        const s = cum[i - 1]! + (cum[i]! - cum[i - 1]!) * t;
        hits.push({ s, piece: p, x: xs[i - 1]! + (xs[i]! - xs[i - 1]!) * t, y: ys[i - 1]! + (ys[i]! - ys[i - 1]!) * t, ax: cx, ay: cy, bx: dx, by: dy });
      }
    }
  }
  hits.sort((a, b) => a.s - b.s);
  const crossingPoints: { s: number; signalized: boolean; lon: number; lat: number }[] = [];
  for (let i = 0; i < hits.length; ) {
    let j = i;
    while (j + 1 < hits.length && hits[j + 1]!.s - hits[i]!.s <= CROSSING_MERGE_M) j++;
    const first = hits[i]!;
    const last = hits[j]!;
    // A true crossing ends on the other side of the road (turning onto it does not).
    const before = pointAt(first.s - CROSSING_PROBE_M);
    const after = pointAt(last.s + CROSSING_PROBE_M);
    const side = (h: typeof first, q: { x: number; y: number }) => {
      const len = Math.hypot(h.bx - h.ax, h.by - h.ay) || 1;
      return ((h.bx - h.ax) * (q.y - h.ay) - (h.by - h.ay) * (q.x - h.ax)) / len;
    };
    const sb = side(first, before);
    const sa = side(last, after);
    const crossed = first.s > CROSSING_PROBE_M / 2 && last.s < lengthM - CROSSING_PROBE_M / 2 && Math.abs(sb) >= 5 && Math.abs(sa) >= 5 && Math.sign(sb) !== Math.sign(first === last ? sa : side(first, after));
    if (crossed) {
      const midS = (first.s + last.s) / 2;
      const pt = pointAt(midS);
      const gdotSignal = sw.signals.some(([lon, lat]) => Math.hypot(P.x(lon) - pt.x, P.y(lat) - pt.y) <= SIGNAL_M);
      crossingPoints.push({ s: midS, signalized: gdotSignal || signalNodeNear(midS), lon: pt.lon, lat: pt.lat });
    }
    i = j + 1;
  }
  const crossings = { unsignalized: crossingPoints.filter((c) => !c.signalized).length, signalized: crossingPoints.filter((c) => c.signalized).length };

  const crashParts = [...parts.values()].filter((p) => p.meters > 0);
  const conditions: RouteConditions = { mode, lengthM, durationS, surfaceM, freewayM, crashParts, lanes, volume, speed, walkFacilities, bikeFacilities, crossings };

  // ---- map segments: where along the route the conditions concentrate
  const focus = (flags: number) => (mode === "walk" ? (flags & FLAG.pedestrian) !== 0 : mode === "bike" ? (flags & FLAG.bicyclist) !== 0 : (flags & FLAG.fatal) !== 0);
  const chunkLen = Math.min(250, Math.max(60, lengthM / 40));
  const chunks = Math.max(1, Math.ceil(lengthM / chunkLen));
  const levels: { level: SegmentLevel; reason: string }[] = [];
  let ci = 0;
  for (let k = 0; k < chunks; k++) {
    const s0 = (k * lengthM) / chunks;
    const s1 = ((k + 1) * lengthM) / chunks;
    let all = 0;
    let focused = 0;
    while (ci < near.length && near[ci]!.s < s1) {
      if (near[ci]!.s >= s0) {
        all++;
        if (focus(crashes.flags[near[ci]!.idx]!)) focused++;
      }
      ci++;
    }
    const km = (s1 - s0) / 1000;
    const expected = ref.contexts[contextAt((s0 + s1) / 2)].mean.all * km;
    const ratio = all / Math.max(expected, 0.05);
    const unsignalized = crossingPoints.some((c) => !c.signalized && c.s >= s0 && c.s < s1);
    const s0i = sampleIndexAt(s0);
    const s1i = sampleIndexAt(s1);
    let wideM = 0;
    for (let i = s0i; i < s1i; i++) {
      const p = samples[i]!.piece;
      if (p >= 0 && roads.role[p] === ROLE.surface && roads.lanes[p]! >= 4) wideM += samples[i]!.w;
    }
    const wide = mode !== "drive" && wideM >= (s1 - s0) * 0.5;
    const focusNoun = mode === "walk" ? "pedestrian" : mode === "bike" ? "bicyclist" : "fatal";
    if (focused > 0) levels.push({ level: "elevated", reason: `${focused} ${focusNoun} crash${focused === 1 ? "" : "es"} reported here` });
    else if (unsignalized) levels.push({ level: "elevated", reason: "Crosses a major road without a traffic signal record" });
    else if (ratio >= 3 && all >= 2) levels.push({ level: "elevated", reason: `${all} crashes reported here — ${ratio.toFixed(1)}× the average for similar streets` });
    else if ((ratio >= 1.5 && all >= 1) || wide) levels.push({ level: "moderate", reason: wide ? "Beside a road with 4+ lanes" : `${all} crash${all === 1 ? "" : "es"} reported here — above the average for similar streets` });
    else levels.push({ level: "lower", reason: all === 0 ? "No crashes reported here" : `${all} crash${all === 1 ? "" : "es"} reported here` });
  }
  const segments: RouteSegment[] = [];
  for (let k = 0; k < chunks; k++) {
    const lv = levels[k]!;
    const s0 = (k * lengthM) / chunks;
    const s1 = ((k + 1) * lengthM) / chunks;
    const coords: LonLat[] = [];
    const a = pointAt(s0);
    coords.push([a.lon, a.lat]);
    for (let i = 0; i < cum.length; i++) if (cum[i]! > s0 && cum[i]! < s1) coords.push(shape[i]!);
    const b = pointAt(s1);
    coords.push([b.lon, b.lat]);
    const prev = segments[segments.length - 1];
    if (prev && prev.level === lv.level && prev.reason === lv.reason) prev.coords.push(...coords.slice(1));
    else segments.push({ level: lv.level, reason: lv.reason, coords });
  }

  // ---- hotspots: 120 m windows with the most mode-relevant crashes
  const bins = new Map<number, { all: number; injury: number; pedestrian: number; bicyclist: number; weight: number; sSum: number }>();
  for (const n of near) {
    const b = Math.floor(n.s / 120);
    const f = crashes.flags[n.idx]!;
    const bin = bins.get(b) ?? { all: 0, injury: 0, pedestrian: 0, bicyclist: 0, weight: 0, sSum: 0 };
    bin.all++;
    if (f & FLAG.injury) bin.injury++;
    if (f & FLAG.pedestrian) bin.pedestrian++;
    if (f & FLAG.bicyclist) bin.bicyclist++;
    bin.weight += focus(f) ? 4 : f & FLAG.injury ? 2 : 1;
    bin.sSum += n.s;
    bins.set(b, bin);
  }
  const ranked = [...bins.entries()].filter(([, v]) => v.all >= 2 || v.weight >= 4).sort((a, b) => b[1].weight - a[1].weight || a[0] - b[0]);
  const chosen: number[] = [];
  for (const [b] of ranked) {
    if (chosen.length >= 4) break;
    if (chosen.some((c) => Math.abs(c - b) <= 1)) continue;
    chosen.push(b);
  }
  const hotspots: Hotspot[] = chosen.map((b) => {
    const v = bins.get(b)!;
    const s = v.sSum / v.all;
    const pt = pointAt(s);
    const here = namesAt(s)[0];
    const other = [namesAt(s - 60)[0], namesAt(s + 60)[0]].find((n) => n && n !== here);
    const label = here ? (other ? `${here} near ${other}` : here) : `${(s / 1609.344).toFixed(1)} mi from the start`;
    return { lon: pt.lon, lat: pt.lat, label, crashes: v.all, injury: v.injury, pedestrian: v.pedestrian, bicyclist: v.bicyclist };
  });
  const avoidPoints: LonLat[] = chosen
    .map((b) => {
      const v = bins.get(b)!;
      const s = v.sSum / v.all;
      return { s, pt: pointAt(s) };
    })
    .filter(({ s }) => s > 150 && s < lengthM - 150)
    .slice(0, 3)
    .map(({ pt }) => [pt.lon, pt.lat] as LonLat);

  // ---- main streets, in order, weighted by distance
  const via: string[] = [];
  if (edgeSpans.length) {
    const byName = new Map<string, number>();
    for (const sp of edgeSpans) {
      const n = sp.e.names[0];
      if (n) byName.set(n, (byName.get(n) ?? 0) + (sp.s1 - sp.s0));
    }
    const major = [...byName.entries()].filter(([, m]) => m >= Math.max(150, lengthM * 0.12)).map(([n]) => n);
    for (const sp of edgeSpans) {
      const n = sp.e.names[0];
      if (n && major.includes(n) && !via.includes(n)) via.push(n);
    }
  }

  return { conditions, segments, hotspots, via: via.slice(0, 3), avoidPoints, lowLightCrashes };
}

/** Square polygon (closed ring) of half-size `m` meters around a point, for Valhalla exclude_polygons. */
export function squareAround([lon, lat]: LonLat, m: number): LonLat[] {
  const dLat = m / ((EARTH_R * Math.PI) / 180);
  const dLon = dLat / Math.cos((lat * Math.PI) / 180);
  return [
    [lon - dLon, lat - dLat],
    [lon + dLon, lat - dLat],
    [lon + dLon, lat + dLat],
    [lon - dLon, lat + dLat],
    [lon - dLon, lat - dLat],
  ];
}

/** Crashes near a point (for pickup and drop-off curb comparison). */
export function crashesNear(sw: Statewide, [lon, lat]: LonLat, radiusM: number): CrashCounts {
  const P = projector(lon, lat);
  const counts = emptyCounts();
  const pad = radiusM / P.my;
  const padLon = radiusM / P.mx;
  for (let gx = Math.floor((lon - padLon + 180) / CRASH_CELL); gx <= Math.floor((lon + padLon + 180) / CRASH_CELL); gx++) {
    for (let gy = Math.floor((lat - pad + 90) / CRASH_CELL); gy <= Math.floor((lat + pad + 90) / CRASH_CELL); gy++) {
      const range = sw.crashes.cells.get(gx * 1_000_000 + gy);
      if (!range) continue;
      for (let k = range[0]; k < range[1]; k++) {
        const c = sw.crashes.order[k]!;
        const f = sw.crashes.flags[c]!;
        if (f & CRASH_FLAG_LIMITED_ACCESS) continue;
        if (Math.hypot(P.x(sw.crashes.lon[c]!), P.y(sw.crashes.lat[c]!)) <= radiusM) addCrash(counts, f);
      }
    }
  }
  return counts;
}

/** GDOT major-road attributes at a point (nearest piece within 25 m), or null on a local street. */
export function roadAt(sw: Statewide, [lon, lat]: LonLat): { lanes: number | null; aadt: number | null; fSystem: number } | null {
  const P = projector(lon, lat);
  const roads = sw.roads;
  const gx = Math.floor((lon + 180) / ROAD_CELL);
  const gy = Math.floor((lat + 90) / ROAD_CELL);
  let best = -1;
  let bestD = 25;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (const p of roads.cells.get((gx + dx) * 1_000_000 + gy + dy) ?? []) {
        if (roads.role[p] === ROLE.accessControlled) continue;
        const start = roads.vOffset[p]!;
        const end = start + roads.vCount[p]!;
        for (let v = start + 1; v < end; v++) {
          const { d } = segDistance(0, 0, P.x(roads.lon[v - 1]!), P.y(roads.lat[v - 1]!), P.x(roads.lon[v]!), P.y(roads.lat[v]!));
          if (d < bestD) {
            bestD = d;
            best = p;
          }
        }
      }
    }
  }
  if (best < 0) return null;
  const l = roads.lanes[best]!;
  const a = roads.aadt[best]!;
  return { lanes: l > 0 ? l : null, aadt: a > 0 ? a : null, fSystem: roads.fSystem[best]! };
}

/** Crash points near a bounding box, for the statewide map's detail layer. */
export function crashesInBox(sw: Statewide, west: number, south: number, east: number, north: number, limit: number): { lon: number; lat: number; flags: number; day: number }[] {
  const out: { lon: number; lat: number; flags: number; day: number }[] = [];
  for (let gx = Math.floor((west + 180) / CRASH_CELL); gx <= Math.floor((east + 180) / CRASH_CELL); gx++) {
    for (let gy = Math.floor((south + 90) / CRASH_CELL); gy <= Math.floor((north + 90) / CRASH_CELL); gy++) {
      const range = sw.crashes.cells.get(gx * 1_000_000 + gy);
      if (!range) continue;
      for (let k = range[0]; k < range[1]; k++) {
        const c = sw.crashes.order[k]!;
        out.push({ lon: sw.crashes.lon[c]!, lat: sw.crashes.lat[c]!, flags: sw.crashes.flags[c]!, day: sw.crashes.day[c]! });
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}
