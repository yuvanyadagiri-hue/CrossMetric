/**
 * RAPTOR (round-based public transit routing) over a compiled timetable.
 *
 * - Forward search: earliest arrival from a set of access stops.
 * - Backward search (on a time-reversed copy of the timetable): latest departure
 *   from every stop that still reaches the destination stops by a deadline. This is
 *   what arrive-by planning needs; no fixed trip duration or binary search over
 *   departure times is assumed.
 *
 * Times are seconds relative to the query day's GTFS reference ("noon minus 12 h").
 * Trips from the previous and next service days are shifted onto that axis, so a
 * 25:10 trip belongs to the day it started.
 */

import { addDays, serviceDayStart, weekdayOf } from "./time";

// ---------------------------------------------------------------------------
// Published network format (pipeline/commute/transit.py)
// ---------------------------------------------------------------------------

export interface NetworkService {
  id: string;
  days: number[]; // Monday-first, as in GTFS calendar.txt
  start: string | null; // YYYYMMDD
  end: string | null;
  added: string[];
  removed: string[];
}

export interface NetworkPattern {
  route: number;
  stops: number[];
  headsign: string;
  profiles: number[][];
  trips: [number, number, number, number][]; // start, profile, service, headway
  shape: [number, number][];
  stopDist: number[];
  /** GTFS wheelchair_accessible shared by every trip of the pattern: 1 accessible, 2 not, 0 (or absent) no information. */
  access?: 0 | 1 | 2;
}

export interface NetworkRoute {
  id: string;
  feed: string;
  short: string;
  long: string;
  color: string;
  text: string;
  type: number;
}

export interface TransitNetwork {
  network: string;
  generatedAt: string;
  feeds: { id: string; name: string; url: string; tracker: string; fileDate: string; feedStart: string | null; feedEnd: string | null; calendarDates: boolean; frequencyBased: boolean }[];
  stops: {
    id: string[];
    name: string[];
    lon: number[];
    lat: number[];
    feed: string[];
    /** GTFS wheelchair_boarding (inherited from the parent station): 1 accessible, 2 not, 0 no information. */
    wheelchair?: number[];
    /** Parent station id, "" when none. */
    parent?: string[];
  };
  /** Parent stations (e.g. MARTA rail stations). */
  stations?: { id: string[]; name: string[]; lon: number[]; lat: number[] };
  routes: NetworkRoute[];
  services: NetworkService[];
  patterns: NetworkPattern[];
  footpaths: [number, number, number][];
}

// ---------------------------------------------------------------------------
// Day timetable
// ---------------------------------------------------------------------------

export interface DayTrip {
  start: number;
  profile: number[];
  headway: number;
  /** Which service day the trip belongs to, relative to the query date (-1, 0, 1). */
  dayOffset: number;
}

export interface DayPattern {
  source: number;
  stops: number[];
  trips: DayTrip[];
}

export interface DayTimetable {
  date: string;
  /** Epoch ms of second 0 on this timetable's axis. */
  ref: number;
  nStops: number;
  patterns: DayPattern[];
  stopPatterns: { pattern: number; index: number }[][];
  footpaths: { to: number; seconds: number }[][];
  reversed: boolean;
}

const ymd = (date: string) => date.replaceAll("-", "");

export function serviceActive(svc: NetworkService, date: string): boolean {
  const d = ymd(date);
  if (svc.removed.includes(d)) return false;
  if (svc.added.includes(d)) return true;
  if (!svc.start || !svc.end || d < svc.start || d > svc.end) return false;
  const wd = weekdayOf(date); // 0 = Sunday
  return svc.days[(wd + 6) % 7] === 1;
}

export interface TimetableOptions {
  walkSpeedMps: number;
  /** Straight-line to walking distance factor. */
  detourFactor: number;
  /** Agencies (feed ids) to leave out, e.g. when a service calendar says "no service". */
  excludeFeeds?: string[];
}

export const TIMETABLE_DEFAULTS: TimetableOptions = { walkSpeedMps: 1.25, detourFactor: 1.3 };

export function buildDayTimetable(net: TransitNetwork, date: string, opts: TimetableOptions = TIMETABLE_DEFAULTS, tz?: string): DayTimetable {
  const ref = serviceDayStart(date, tz);
  const days = [-1, 0, 1].map((off) => {
    const d = addDays(date, off);
    const shift = Math.round((serviceDayStart(d, tz) - ref) / 1000);
    const active = net.services.map((s) => serviceActive(s, d));
    return { off, shift, active };
  });
  const exclude = new Set(opts.excludeFeeds ?? []);
  const patterns: DayPattern[] = [];
  net.patterns.forEach((p, source) => {
    const feed = net.routes[p.route]?.feed ?? "";
    if (exclude.has(feed)) return;
    const trips: DayTrip[] = [];
    const lastArr = (prof: number[]) => prof[prof.length - 2]!;
    for (const [start, profIdx, svc, headway] of p.trips) {
      const prof = p.profiles[profIdx]!;
      for (const day of days) {
        if (!day.active[svc]) continue;
        const s = start + day.shift;
        // Keep trips that touch the window from 03:00 the day before to 06:00 the day after.
        if (s + lastArr(prof) < -21 * 3600 || s > 54 * 3600) continue;
        trips.push({ start: s, profile: prof, headway, dayOffset: day.off });
      }
    }
    if (!trips.length) return;
    trips.sort((a, b) => a.start - b.start);
    patterns.push({ source, stops: p.stops, trips });
  });
  const nStops = net.stops.id.length;
  const footpaths: { to: number; seconds: number }[][] = Array.from({ length: nStops }, () => []);
  for (const [a, b, m] of net.footpaths) footpaths[a]!.push({ to: b, seconds: Math.round((m * opts.detourFactor) / opts.walkSpeedMps) });
  return { date, ref, nStops, patterns, stopPatterns: indexStops(patterns, nStops), footpaths, reversed: false };
}

function indexStops(patterns: DayPattern[], nStops: number) {
  const out: { pattern: number; index: number }[][] = Array.from({ length: nStops }, () => []);
  patterns.forEach((p, pi) => p.stops.forEach((s, i) => out[s]!.push({ pattern: pi, index: i })));
  return out;
}

const reversedProfiles = new WeakMap<number[], number[]>();

function reverseProfile(prof: number[]): number[] {
  let r = reversedProfiles.get(prof);
  if (r) return r;
  const n = prof.length / 2;
  const total = prof[2 * (n - 1)]!;
  r = new Array<number>(prof.length);
  for (let j = 0; j < n; j++) {
    const i = n - 1 - j;
    r[2 * j] = total - prof[2 * i + 1]!;
    r[2 * j + 1] = total - prof[2 * i]!;
  }
  reversedProfiles.set(prof, r);
  return r;
}

/** Time-reversed copy: t -> -t, stop order reversed. Earliest arrival here = latest departure there. */
export function reverseTimetable(tt: DayTimetable): DayTimetable {
  const patterns: DayPattern[] = tt.patterns.map((p) => {
    const trips = p.trips.map((t) => ({ start: -(t.start + t.profile[t.profile.length - 2]!), profile: reverseProfile(t.profile), headway: t.headway, dayOffset: t.dayOffset }));
    trips.sort((a, b) => a.start - b.start);
    return { source: p.source, stops: [...p.stops].reverse(), trips };
  });
  return { ...tt, patterns, stopPatterns: indexStops(patterns, tt.nStops), reversed: true };
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface AccessPoint {
  stop: number;
  /** Seconds of walking between the place and the stop. */
  seconds: number;
}

type Parent =
  | { kind: "access"; seconds: number }
  | { kind: "ride"; pattern: number; trip: number; from: number; boardIndex: number; alightIndex: number }
  | { kind: "walk"; from: number; seconds: number };

export interface SearchResult {
  tt: DayTimetable;
  rounds: number;
  /** best[k][stop]: best time with at most k rides (Infinity when unreachable). */
  best: Float64Array[];
  parents: (Parent | undefined)[][];
}

export interface SearchOptions {
  maxRides: number;
  /** Seconds required between reaching a stop and the vehicle's departure. */
  boardSlack: number;
  /** Seconds added after leaving a vehicle (used by the reversed search to place slack before boarding). */
  alightSlack: number;
}

export const SEARCH_DEFAULTS: SearchOptions = { maxRides: 3, boardSlack: 60, alightSlack: 0 };

function depAt(t: DayTrip, i: number) {
  return t.start + t.profile[2 * i + 1]!;
}
function arrAt(t: DayTrip, i: number) {
  return t.start + t.profile[2 * i]!;
}

function earliestTrip(p: DayPattern, i: number, time: number): number {
  const trips = p.trips;
  let lo = 0;
  let hi = trips.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (depAt(trips[mid]!, i) < time) lo = mid + 1;
    else hi = mid;
  }
  // Tolerate a little non-FIFO ordering (a trip that starts later but runs faster).
  let best = lo < trips.length ? lo : -1;
  for (let k = Math.max(0, lo - 3); k < lo; k++) if (depAt(trips[k]!, i) >= time && (best < 0 || depAt(trips[k]!, i) < depAt(trips[best]!, i))) best = k;
  return best;
}

export function raptor(tt: DayTimetable, sources: { stop: number; time: number }[], opts: SearchOptions = SEARCH_DEFAULTS): SearchResult {
  const n = tt.nStops;
  const rounds = opts.maxRides;
  const best: Float64Array[] = [];
  const parents: (Parent | undefined)[][] = [];
  const star = new Float64Array(n).fill(Infinity);
  const r0 = new Float64Array(n).fill(Infinity);
  const p0: (Parent | undefined)[] = new Array(n);
  let marked = new Set<number>();
  for (const s of sources) {
    if (s.time < r0[s.stop]!) {
      r0[s.stop] = s.time;
      star[s.stop] = s.time;
      p0[s.stop] = { kind: "access", seconds: 0 };
      marked.add(s.stop);
    }
  }
  // Initial footpaths from access stops.
  for (const s of [...marked]) {
    for (const f of tt.footpaths[s]!) {
      const t = r0[s]! + f.seconds;
      if (t < r0[f.to]!) {
        r0[f.to] = t;
        star[f.to] = Math.min(star[f.to]!, t);
        p0[f.to] = { kind: "walk", from: s, seconds: f.seconds };
        marked.add(f.to);
      }
    }
  }
  best.push(r0);
  parents.push(p0);

  for (let k = 1; k <= rounds && marked.size; k++) {
    const prev = best[k - 1]!;
    const cur = Float64Array.from(prev);
    const par: (Parent | undefined)[] = new Array(n);
    // Patterns touched by marked stops, from their earliest marked position.
    const queue = new Map<number, number>();
    for (const s of marked) {
      for (const { pattern, index } of tt.stopPatterns[s]!) {
        const q = queue.get(pattern);
        if (q === undefined || index < q) queue.set(pattern, index);
      }
    }
    const newly = new Set<number>();
    for (const [pi, startIdx] of queue) {
      const p = tt.patterns[pi]!;
      let trip = -1;
      let boardIdx = -1;
      for (let i = startIdx; i < p.stops.length; i++) {
        const s = p.stops[i]!;
        if (trip >= 0) {
          const arr = arrAt(p.trips[trip]!, i) + opts.alightSlack;
          if (arr < star[s]! && arr < cur[s]!) {
            cur[s] = arr;
            star[s] = arr;
            par[s] = { kind: "ride", pattern: pi, trip, from: p.stops[boardIdx]!, boardIndex: boardIdx, alightIndex: i };
            newly.add(s);
          }
        }
        const ready = prev[s]! + opts.boardSlack;
        if (Number.isFinite(prev[s]!) && (trip < 0 || ready <= depAt(p.trips[trip]!, i))) {
          const t = earliestTrip(p, i, ready);
          if (t >= 0 && (trip < 0 || depAt(p.trips[t]!, i) < depAt(p.trips[trip]!, i))) {
            trip = t;
            boardIdx = i;
          }
        }
      }
    }
    // Transfers on foot.
    for (const s of [...newly]) {
      for (const f of tt.footpaths[s]!) {
        const t = cur[s]! + f.seconds;
        if (t < cur[f.to]! && t < star[f.to]!) {
          cur[f.to] = t;
          star[f.to] = t;
          par[f.to] = { kind: "walk", from: s, seconds: f.seconds };
          newly.add(f.to);
        }
      }
    }
    best.push(cur);
    parents.push(par);
    marked = newly;
  }
  return { tt, rounds: best.length - 1, best, parents };
}

// ---------------------------------------------------------------------------
// Journeys
// ---------------------------------------------------------------------------

export interface RideLeg {
  kind: "ride";
  pattern: number;
  source: number;
  fromStop: number;
  toStop: number;
  boardIndex: number;
  alightIndex: number;
  depart: number;
  arrive: number;
  headway: number;
  dayOffset: number;
}

export interface WalkLeg {
  kind: "walk";
  fromStop: number;
  toStop: number;
  seconds: number;
}

export type JourneyLeg = RideLeg | WalkLeg;

/** Rebuild the forward-search journey that reaches `target` with at most `k` rides. */
export function journeyTo(res: SearchResult, target: number, k: number): JourneyLeg[] | null {
  if (!Number.isFinite(res.best[k]?.[target] ?? Infinity)) return null;
  const legs: JourneyLeg[] = [];
  let stop = target;
  let round = k;
  for (let guard = 0; guard < 64; guard++) {
    // Find the round where this stop's label was set.
    while (round > 0 && res.parents[round]![stop] === undefined) round--;
    const par = res.parents[round]![stop];
    if (!par || par.kind === "access") return legs.reverse();
    if (par.kind === "walk") {
      legs.push({ kind: "walk", fromStop: par.from, toStop: stop, seconds: par.seconds });
      stop = par.from;
      continue;
    }
    const p = res.tt.patterns[par.pattern]!;
    const t = p.trips[par.trip]!;
    legs.push({
      kind: "ride",
      pattern: par.pattern,
      source: p.source,
      fromStop: par.from,
      toStop: stop,
      boardIndex: par.boardIndex,
      alightIndex: par.alightIndex,
      depart: depAt(t, par.boardIndex),
      arrive: arrAt(t, par.alightIndex),
      headway: t.headway,
      dayOffset: t.dayOffset,
    });
    stop = par.from;
    round--;
  }
  return null;
}

/** Forward legs from a reversed-search journey (times converted back to the forward axis). */
export function unreverse(legs: JourneyLeg[], reversed: DayTimetable, forward: DayTimetable): JourneyLeg[] {
  return legs
    .map((l): JourneyLeg => {
      if (l.kind === "walk") return { kind: "walk", fromStop: l.toStop, toStop: l.fromStop, seconds: l.seconds };
      const n = reversed.patterns[l.pattern]!.stops.length;
      const fwdPattern = forward.patterns.findIndex((p) => p.source === l.source);
      return {
        ...l,
        pattern: fwdPattern,
        fromStop: l.toStop,
        toStop: l.fromStop,
        boardIndex: n - 1 - l.alightIndex,
        alightIndex: n - 1 - l.boardIndex,
        depart: -l.arrive,
        arrive: -l.depart,
      };
    })
    .reverse();
}

export interface TransitPlan {
  /** Latest departure from the origin (timetable seconds). */
  leave: number;
  /** Arrival at the destination (timetable seconds). */
  arrive: number;
  access: AccessPoint;
  egress: AccessPoint;
  legs: JourneyLeg[];
  rides: number;
}

/**
 * Latest departure from `origin` access points that reaches `dest` access points by `deadline`.
 * Returns the forward itinerary for that departure, or null when nothing reaches in time.
 */
export function latestDeparture(
  forward: DayTimetable,
  reversed: DayTimetable,
  origin: AccessPoint[],
  dest: AccessPoint[],
  deadline: number,
  opts: SearchOptions = SEARCH_DEFAULTS,
  /** Ignore departures more than this many seconds before the deadline. */
  horizonS = 4 * 3600,
): TransitPlan | null {
  if (!origin.length || !dest.length) return null;
  const back = raptor(
    reversed,
    dest.map((d) => ({ stop: d.stop, time: -(deadline - d.seconds) })),
    { ...opts, boardSlack: 0, alightSlack: opts.boardSlack },
  );
  let bestLeave = -Infinity;
  let bestK = Infinity;
  let bestAccess: AccessPoint | null = null;
  for (let k = 1; k <= back.rounds; k++) {
    for (const o of origin) {
      const t = back.best[k]![o.stop]!;
      if (!Number.isFinite(t)) continue;
      const leave = -t - o.seconds;
      if (leave < deadline - horizonS) continue;
      // Latest departure wins; within 30 s, fewer rides wins.
      if (leave > bestLeave + 30 || (Math.abs(leave - bestLeave) <= 30 && k < bestK)) {
        bestLeave = leave;
        bestK = k;
        bestAccess = o;
      }
    }
  }
  if (!bestAccess) return null;
  // Replay forward from that departure so every time shown is a real forward connection.
  const fwd = earliestArrival(forward, [{ stop: bestAccess.stop, seconds: bestAccess.seconds }], dest, bestLeave, { ...opts, maxRides: bestK });
  if (fwd && fwd.arrive <= deadline) return { ...fwd, leave: bestLeave };
  const legs = journeyTo(back, bestAccess.stop, bestK);
  if (!legs) return null;
  const fl = unreverse(legs, reversed, forward);
  const lastRide = [...fl].reverse().find((l): l is RideLeg => l.kind === "ride");
  const egress = dest.find((d) => d.stop === (fl[fl.length - 1]?.toStop ?? -1)) ?? dest[0]!;
  return { leave: bestLeave, arrive: (lastRide?.arrive ?? bestLeave) + egress.seconds, access: bestAccess, egress, legs: fl, rides: bestK };
}

/** Earliest arrival at `dest` leaving `origin` at `departAt` (timetable seconds). */
export function earliestArrival(tt: DayTimetable, origin: AccessPoint[], dest: AccessPoint[], departAt: number, opts: SearchOptions = SEARCH_DEFAULTS): TransitPlan | null {
  if (!origin.length || !dest.length) return null;
  const res = raptor(
    tt,
    origin.map((o) => ({ stop: o.stop, time: departAt + o.seconds })),
    opts,
  );
  let best: { arrive: number; k: number; egress: AccessPoint } | null = null;
  for (let k = 1; k <= res.rounds; k++) {
    for (const d of dest) {
      const t = res.best[k]![d.stop]!;
      if (!Number.isFinite(t)) continue;
      const arrive = t + d.seconds;
      if (!best || arrive < best.arrive - 30 || (arrive < best.arrive + 30 && k < best.k)) best = { arrive, k, egress: d };
    }
  }
  if (!best) return null;
  const legs = journeyTo(res, best.egress.stop, best.k);
  if (!legs || !legs.some((l) => l.kind === "ride")) return null;
  const firstStop = legs[0]!.kind === "walk" ? legs[0]!.fromStop : (legs[0] as RideLeg).fromStop;
  const access = origin.find((o) => o.stop === firstStop) ?? origin[0]!;
  return { leave: departAt, arrive: best.arrive, access, egress: best.egress, legs, rides: legs.filter((l) => l.kind === "ride").length };
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

const stopPatternCache = new WeakMap<TransitNetwork, number[][]>();

function patternsByStop(net: TransitNetwork): number[][] {
  let out = stopPatternCache.get(net);
  if (!out) {
    out = Array.from({ length: net.stops.id.length }, () => [] as number[]);
    net.patterns.forEach((p, pi) => p.stops.forEach((s) => out![s]!.push(pi)));
    stopPatternCache.set(net, out);
  }
  return out;
}

/**
 * Boarding stops within `maxM` metres (straight line) of a point, with walking seconds.
 * Nearest first, keeping a farther stop only when it is served by a pattern no nearer stop has,
 * so one large station's many bays do not crowd out other lines.
 */
export function nearbyStops(net: TransitNetwork, lon: number, lat: number, maxM: number, opts: TimetableOptions = TIMETABLE_DEFAULTS, limit = 24): AccessPoint[] {
  const k = Math.cos((lat * Math.PI) / 180);
  const out: { stop: number; m: number }[] = [];
  for (let i = 0; i < net.stops.id.length; i++) {
    const m = Math.hypot((net.stops.lon[i]! - lon) * k, net.stops.lat[i]! - lat) * 111_195;
    if (m <= maxM) out.push({ stop: i, m });
  }
  out.sort((a, b) => a.m - b.m);
  const byStop = patternsByStop(net);
  const seen = new Set<number>();
  const kept: AccessPoint[] = [];
  for (const o of out) {
    const pats = byStop[o.stop]!;
    if (!pats.some((p) => !seen.has(p))) continue;
    pats.forEach((p) => seen.add(p));
    kept.push({ stop: o.stop, seconds: Math.round((o.m * opts.detourFactor) / opts.walkSpeedMps) });
    if (kept.length >= limit) break;
  }
  return kept;
}

/** The part of a pattern's shape between two stop positions. */
export function rideGeometry(net: TransitNetwork, source: number, boardIndex: number, alightIndex: number): [number, number][] {
  const p = net.patterns[source]!;
  const from = p.stopDist[boardIndex];
  const to = p.stopDist[alightIndex];
  const stopsLine = p.stops.slice(boardIndex, alightIndex + 1).map((s) => [net.stops.lon[s]!, net.stops.lat[s]!] as [number, number]);
  if (from === undefined || to === undefined || p.shape.length < 2 || to <= from) return stopsLine;
  const k = Math.cos((p.shape[0]![1] * Math.PI) / 180) * 111_195;
  const out: [number, number][] = [stopsLine[0]!];
  let acc = 0;
  for (let i = 1; i < p.shape.length; i++) {
    const a = p.shape[i - 1]!;
    const b = p.shape[i]!;
    const seg = Math.hypot((b[0] - a[0]) * k, (b[1] - a[1]) * 111_195);
    if (acc + seg > from && acc < to) out.push(b);
    acc += seg;
    if (acc >= to) break;
  }
  out.push(stopsLine[stopsLine.length - 1]!);
  return out;
}
