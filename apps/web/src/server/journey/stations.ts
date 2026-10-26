import "server-only";

import { tidyStopName } from "@/lib/names";
import type { Place } from "@/lib/trip-types";
import { getNetwork } from "../commute/data";
import { railStops, REGIONS } from "./networks";

interface StationEntry {
  label: string;
  words: string[];
  sublabel: string;
  lon: number;
  lat: number;
}

let index: Promise<StationEntry[]> | null = null;

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Rail stations (parent stations served by rail) from the compiled timetables. */
function stationIndex(): Promise<StationEntry[]> {
  index ??= (async () => {
    const out: StationEntry[] = [];
    for (const region of REGIONS) {
      const net = await getNetwork(region.campus).catch(() => null);
      if (!net?.stations) continue;
      const rail = railStops(net);
      const parents = net.stops.parent ?? [];
      const agency = net.feeds.map((f) => f.name).join(", ");
      net.stations.id.forEach((id, i) => {
        const isRail = parents.some((p, stop) => p === id && rail.has(stop));
        if (!isRail) return;
        const label = tidyStopName(net.stations!.name[i]!);
        out.push({ label, words: norm(label).split(" "), sublabel: `${agency} rail station`, lon: net.stations!.lon[i]!, lat: net.stations!.lat[i]! });
      });
    }
    return out;
  })();
  index.catch(() => (index = null));
  return index;
}

/**
 * Transit stations matching a query ("five points", "lindbergh station", "marta north springs").
 * A station is a better answer than a geocoder hit with a similar name elsewhere in Georgia.
 */
export async function searchStations(query: string, limit = 3): Promise<Place[]> {
  const q = norm(query)
    .split(" ")
    .filter((w) => w && !["marta", "station", "stn", "train", "rail", "the"].includes(w));
  if (!q.length || q.join("").length < 3) return [];
  const all = await stationIndex().catch(() => [] as StationEntry[]);
  return all
    .filter((s) => q.every((w) => s.words.some((x) => x.startsWith(w))))
    .slice(0, limit)
    .map((s) => ({ label: s.label, sublabel: s.sublabel, lon: s.lon, lat: s.lat, kind: "station" as const }));
}
