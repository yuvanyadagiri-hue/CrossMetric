import "server-only";

import type { LonLat } from "@/lib/trip-types";
import { readStatewideLayer } from "./statewide";

/** MARTA stops from the statewide transit layer (pipeline/ingestion/transit.py). */
export interface TransitData {
  stops: { id: string[]; name: string[]; lon: number[]; lat: number[]; rail: boolean[]; routes: string[][] };
}

let transit: Promise<TransitData> | null = null;
export function getTransit(): Promise<TransitData> {
  transit ??= readStatewideLayer("transit").then((t) => JSON.parse(t) as TransitData);
  transit.catch(() => {
    transit = null;
  });
  return transit;
}

export function nearestStops(t: TransitData, [lon, lat]: LonLat, maxM: number, n: number) {
  const k = Math.cos((lat * Math.PI) / 180);
  const out: { i: number; d: number }[] = [];
  for (let i = 0; i < t.stops.id.length; i++) {
    const d = Math.hypot((t.stops.lon[i]! - lon) * k, t.stops.lat[i]! - lat) * 111_195;
    if (d <= maxM) out.push({ i, d });
  }
  return out.sort((a, b) => a.d - b.d).slice(0, n);
}

