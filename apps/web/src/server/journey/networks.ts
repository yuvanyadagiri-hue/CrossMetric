import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { localDate, nearbyStops, type AccessPoint, type TransitNetwork } from "@crossmetric/engine/commute";
import type { CampusId, LonLat, SourceRef } from "@/lib/commute-types";
import type { TransitCoverage } from "@/lib/journey-types";
import { getCampus, getNetwork } from "../commute/data";

/**
 * Transit timetables CrossMetric has, by region. Each region's network is compiled
 * by pipeline/commute/transit.py and shares its fares and calendar notes with the
 * campus record of the same id. Adding an agency means adding its feed to a
 * network (or a new network here); nothing else needs to change.
 */
export const REGIONS: { id: TransitCoverage["network"]; campus: CampusId; name: string }[] = [
  { id: "atlanta", campus: "gt", name: "Metro Atlanta" },
  { id: "athens", campus: "uga", name: "Athens" },
];

export const ACCESS_RADIUS_M = 1200;
export const EGRESS_RADIUS_M = 1000;

export function agencyNames(net: TransitNetwork): string[] {
  return net.feeds.map((f) => f.name);
}

/** Stops within walking reach of a point (straight-line radius, walking time with a detour factor). */
export function reach(net: TransitNetwork, p: LonLat, radiusM: number, walkSpeedMps: number): AccessPoint[] {
  return nearbyStops(net, p[0], p[1], radiusM, { walkSpeedMps, detourFactor: 1.3 });
}

/** Rail stops: served by at least one pattern of a rail route (GTFS route_type 0, 1 or 2). */
const railCache = new WeakMap<TransitNetwork, Set<number>>();
export function railStops(net: TransitNetwork): Set<number> {
  let set = railCache.get(net);
  if (!set) {
    set = new Set<number>();
    for (const p of net.patterns) {
      const type = net.routes[p.route]?.type ?? 3;
      if (type === 1 || type === 2) for (const s of p.stops) set.add(s);
    }
    railCache.set(net, set);
  }
  return set;
}

/** Routes serving each stop (short names, deduplicated), for station details. */
const routesCache = new WeakMap<TransitNetwork, string[][]>();
export function routesAtStops(net: TransitNetwork): string[][] {
  let out = routesCache.get(net);
  if (!out) {
    out = net.stops.id.map(() => [] as string[]);
    for (const p of net.patterns) {
      const r = net.routes[p.route];
      if (!r) continue;
      const name = r.short || r.long;
      for (const s of p.stops) if (!out[s]!.includes(name)) out[s]!.push(name);
    }
    routesCache.set(net, out);
  }
  return out;
}

// ---------------------------------------------------------------------------
// MARTA station parking (hand-verified record, data/commute/marta-parking.json)
// ---------------------------------------------------------------------------

export interface StationParking {
  id: string;
  name: string;
  freeDaily: boolean;
  longTermDaily: number | null;
  note?: string;
}

export interface StationParkingRecord {
  retrieved: string;
  reviewBy: string;
  paidFreeHours: number;
  stations: StationParking[];
  sources: Record<string, Omit<SourceRef, "id" | "retrieved" | "reviewBy">>;
}

let parkingRecord: Promise<StationParkingRecord | null> | null = null;

export function martaStationParking(): Promise<StationParkingRecord | null> {
  parkingRecord ??= (async () => {
    const dir = process.env.COMMUTE_RULES_DIR ?? path.resolve(process.cwd(), "..", "..", "data", "commute");
    try {
      return JSON.parse(await readFile(path.join(dir, "marta-parking.json"), "utf-8")) as StationParkingRecord;
    } catch {
      return null;
    }
  })();
  return parkingRecord;
}

/** The record applies only until its re-check date; after that station parking is treated as unknown. */
export function parkingRecordCurrent(rec: StationParkingRecord, now: number): boolean {
  return localDate(now) <= rec.reviewBy;
}

export async function regionData(region: (typeof REGIONS)[number]) {
  const [net, campus] = await Promise.all([getNetwork(region.campus), getCampus(region.campus)]);
  return { net, campus };
}
