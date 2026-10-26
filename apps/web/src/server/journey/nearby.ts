import "server-only";

import { localDate, type TransitNetwork } from "@crossmetric/engine/commute";
import type { LonLat, RouteBadge } from "@/lib/commute-types";
import { tidyStopName } from "@/lib/names";
import type { NearbyResponse, NearbyStation } from "@/lib/nearby-types";
import { transitDay, type TransitDay } from "../commute/transit";
import { matrix } from "../valhalla";
import { straightM } from "../commute/plan";
import { martaStationParking, parkingRecordCurrent, railStops, REGIONS } from "./networks";

const SEARCH_M = 1600;
const WALK_RANK = 12;
const DEPARTURE_WINDOW_S = 60 * 60;
const TZ = "America/New_York";

function badgeOf(day: TransitDay, pattern: number): RouteBadge {
  const net = day.net;
  const r = net.routes[net.patterns[pattern]!.route]!;
  return { short: r.short || r.long, long: r.long, color: r.color, text: r.text, agency: net.feeds.find((f) => f.id === r.feed)?.name ?? r.feed };
}

function departures(day: TransitDay, stops: number[], nowS: number): NearbyStation["departures"] {
  const out: NearbyStation["departures"] = [];
  for (const stop of stops) {
    for (const { pattern, index } of day.forward.stopPatterns[stop] ?? []) {
      const p = day.forward.patterns[pattern]!;
      if (index === p.stops.length - 1) continue;
      const src = day.net.patterns[p.source]!;
      let n = 0;
      for (const t of p.trips) {
        const dep = t.start + t.profile[2 * index + 1]!;
        if (dep < nowS || dep > nowS + DEPARTURE_WINDOW_S) continue;
        out.push({ route: badgeOf(day, p.source), headsign: tidyStopName(src.headsign), time: day.forward.ref + dep * 1000, headway: t.headway });
        if (++n >= 2) break;
      }
    }
  }
  out.sort((a, b) => a.time - b.time);
  // One row per route and direction, soonest first.
  const seen = new Set<string>();
  return out.filter((d) => (seen.has(`${d.route.short}|${d.headsign}`) ? false : (seen.add(`${d.route.short}|${d.headsign}`), true))).slice(0, 6);
}

/**
 * Every stop within a radius, nearest first. (The routing helper nearbyStops keeps only
 * stops that add a new pattern, which is right for planning but would hide stops here.)
 */
function stopsWithin(net: TransitNetwork, at: LonLat, radiusM: number, limit: number): number[] {
  const k = Math.cos((at[1] * Math.PI) / 180);
  const out: { stop: number; m: number }[] = [];
  for (let i = 0; i < net.stops.id.length; i++) {
    const m = Math.hypot((net.stops.lon[i]! - at[0]) * k, net.stops.lat[i]! - at[1]) * 111_195;
    if (m <= radiusM) out.push({ stop: i, m });
  }
  return out
    .sort((a, b) => a.m - b.m)
    .slice(0, limit)
    .map((o) => o.stop);
}

interface Group {
  key: string;
  name: string;
  rail: boolean;
  stops: number[];
  point: LonLat;
  straight: number;
  day: TransitDay;
  network: NearbyStation["network"];
  stationId: string | null;
}

/**
 * Stations and stops near a point, ranked by routed walking time (straight-line
 * distance only decides which ones are worth routing). Departures are scheduled
 * timetable times, never live predictions.
 */
export { tidyStopName };

export async function nearbyTransit(at: LonLat, opts: { railOnly?: boolean; walkSpeedMps?: number; now?: number } = {}): Promise<NearbyResponse> {
  const now = opts.now ?? Date.now();
  const walkSpeed = opts.walkSpeedMps ?? 1.25;
  const groups: Group[] = [];
  const notes: string[] = [];
  const days: { region: (typeof REGIONS)[number]; day: TransitDay }[] = [];
  for (const region of REGIONS) {
    const day = await transitDay(region.campus, localDate(now, TZ), walkSpeed).catch(() => null);
    if (!day) {
      notes.push(`${region.name} timetables could not be loaded`);
      continue;
    }
    days.push({ region, day });
    if (day.note) notes.push(day.note);
    const net = day.net;
    const rail = railStops(net);
    const parents = net.stops.parent ?? [];
    const byKey = new Map<string, Group>();
    for (const stop of stopsWithin(net, at, SEARCH_M, 150)) {
      if (!(day.forward.stopPatterns[stop]?.length)) continue;
      const parent = parents[stop] || "";
      const si = parent && net.stations ? net.stations.id.indexOf(parent) : -1;
      const isRail = rail.has(stop);
      const point: LonLat = si >= 0 ? [net.stations!.lon[si]!, net.stations!.lat[si]!] : [net.stops.lon[stop]!, net.stops.lat[stop]!];
      // Platforms group by station; bus stops with the same name group within ~150 m (both sides of a street).
      let key = si >= 0 ? `st:${parent}` : `name:${net.stops.name[stop]!.toUpperCase()}`;
      const existing = byKey.get(key);
      if (existing && si < 0 && straightM(existing.point, point) > 150) key = `${key}#${stop}`;
      const g = byKey.get(key);
      if (g) {
        g.stops.push(stop);
        g.rail ||= isRail;
        g.straight = Math.min(g.straight, straightM(at, [net.stops.lon[stop]!, net.stops.lat[stop]!]));
        continue;
      }
      byKey.set(key, {
        key: `${region.id}:${key}`,
        name: tidyStopName(si >= 0 ? net.stations!.name[si]! : net.stops.name[stop]!),
        rail: isRail,
        stops: [stop],
        point,
        straight: straightM(at, [net.stops.lon[stop]!, net.stops.lat[stop]!]),
        day,
        network: region.id,
        stationId: si >= 0 ? parent : null,
      });
    }
    groups.push(...byKey.values());
  }

  const pool = groups.filter((g) => !opts.railOnly || g.rail).sort((a, b) => a.straight - b.straight).slice(0, WALK_RANK);
  const walks = pool.length
    ? await matrix("walk", [at], pool.map((g) => g.point), { walking_speed: Math.round(walkSpeed * 3.6 * 10) / 10 })
        .then((m) => m[0] ?? [])
        .catch(() => null)
    : [];
  if (pool.length && walks === null) notes.push("Walking times are unavailable right now; distances are straight-line");

  const parking = await martaStationParking();
  const parkingOk = parking && parkingRecordCurrent(parking, now);
  const describe = (g: Group, walk: { meters: number | null; seconds: number | null } | null): NearbyStation => {
    const net = g.day.net;
    const wc = net.stops.wheelchair;
    const flags = g.stops.map((s) => wc?.[s] ?? 0);
    const routes = new Map<string, RouteBadge>();
    for (const s of g.stops) for (const { pattern } of g.day.forward.stopPatterns[s] ?? []) {
      const b = badgeOf(g.day, g.day.forward.patterns[pattern]!.source);
      routes.set(b.short, b);
    }
    const p = g.stationId && parkingOk ? parking!.stations.find((x) => x.id === g.stationId) : null;
    return {
      id: g.key,
      name: g.name,
      kind: g.rail ? "rail" : "bus",
      network: g.network,
      agencies: [...new Set([...routes.values()].map((r) => r.agency))],
      lon: g.point[0],
      lat: g.point[1],
      straightM: Math.round(g.straight),
      walkM: walk?.meters ?? null,
      walkMin: walk?.seconds !== null && walk?.seconds !== undefined ? Math.max(1, Math.round(walk.seconds / 60)) : null,
      routes: [...routes.values()].sort((a, b) => a.short.localeCompare(b.short, undefined, { numeric: true })).slice(0, 12),
      departures: departures(g.day, g.stops, (now - g.day.forward.ref) / 1000),
      wheelchair: flags.every((f) => f === 1) ? "yes" : flags.some((f) => f === 2) ? "no" : "unknown",
      parking: p ? (p.longTermDaily ? `Parking: free for the first ${parking!.paidFreeHours} hours, then $${p.longTermDaily}/day` : "Free daily parking") : null,
    };
  };
  const stations = pool
    .map((g, i) => describe(g, walks ? (walks[i] ?? null) : null))
    .sort((a, b) => (a.walkMin ?? Infinity) - (b.walkMin ?? Infinity) || a.straightM - b.straightM);

  // No rail station within walking reach: the nearest one by car, said plainly (MARTA only runs where it runs).
  let nearestRail: NearbyResponse["nearestRail"] = null;
  if (!stations.some((s) => s.kind === "rail")) {
    let best: { g: Group; m: number } | null = null;
    for (const { region, day } of days) {
      const net = day.net;
      if (!net.stations) continue;
      const rail = railStops(net);
      const parents = net.stops.parent ?? [];
      net.stations.id.forEach((id, i) => {
        const served = parents.some((p, stop) => p === id && rail.has(stop));
        if (!served) return;
        const point: LonLat = [net.stations!.lon[i]!, net.stations!.lat[i]!];
        const m = straightM(at, point);
        if (!best || m < best.m) best = { m, g: { key: `${region.id}:st:${id}`, name: tidyStopName(net.stations!.name[i]!), rail: true, stops: parents.flatMap((p, s) => (p === id ? [s] : [])), point, straight: m, day, network: region.id, stationId: id } };
      });
    }
    if (best) {
      const b = best as { g: Group; m: number };
      const drive = await matrix("drive", [at], [b.g.point]).then((m) => m[0]?.[0] ?? null).catch(() => null);
      nearestRail = { station: describe(b.g, null), driveMin: drive?.seconds != null ? Math.max(1, Math.round(drive.seconds / 60)) : null, driveM: drive?.meters ?? null };
    }
  }

  const coverage = stations.length
    ? null
    : opts.railOnly
      ? "No rail station within about a mile."
      : "No MARTA, Athens-Clarke County Transit or UGA Campus Transit stops within about a mile. Other Georgia transit agencies are not in CrossMetric's timetables yet.";
  return { at: { lon: at[0], lat: at[1] }, generatedAt: now, stations, nearestRail, coverage, notes: [...new Set(notes)], scheduledOnly: true };
}
