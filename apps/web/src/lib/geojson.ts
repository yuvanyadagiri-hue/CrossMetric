import { crashMatchesFilter, periodWindow } from "@crossmetric/engine";
import type { AnalysisResult, PriorityBandId, SchoolPackage } from "@crossmetric/engine";

type Position = [number, number];

export interface FeatureCollection<P> {
  type: "FeatureCollection";
  features: { type: "Feature"; id?: number; properties: P; geometry: { type: string; coordinates: unknown } }[];
}

const EARTH_RADIUS_M = 6_371_008.8;

/** Geodesic circle (polygon ring) of `radiusM` meters around a point. */
export function circleRing(lon: number, lat: number, radiusM: number, steps = 128): Position[] {
  const ring: Position[] = [];
  const latR = (lat * Math.PI) / 180;
  const lonR = (lon * Math.PI) / 180;
  const d = radiusM / EARTH_RADIUS_M;
  for (let i = 0; i <= steps; i++) {
    const brng = (2 * Math.PI * i) / steps;
    const lat2 = Math.asin(Math.sin(latR) * Math.cos(d) + Math.cos(latR) * Math.sin(d) * Math.cos(brng));
    const lon2 = lonR + Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(latR), Math.cos(d) - Math.sin(latR) * Math.sin(lat2));
    ring.push([(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
  }
  return ring;
}

export function circleFeature(lon: number, lat: number, radiusM: number): FeatureCollection<Record<string, never>> {
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [circleRing(lon, lat, radiusM)] } }],
  };
}

export interface CandidateProps {
  id: string;
  kind: "intersection" | "segment";
  band: PriorityBandId;
  priority: number;
  rank: number;
  name: string;
  order: number; // draw order: higher priority on top
}

/** Candidate features for the map. `id` is a stable numeric feature id for feature-state. */
export function candidateFeatures(result: AnalysisResult): FeatureCollection<CandidateProps> {
  return {
    type: "FeatureCollection",
    features: result.candidates.map((s) => ({
      type: "Feature",
      id: s.index,
      properties: {
        id: s.candidate.id,
        kind: s.candidate.kind,
        band: s.band.id,
        priority: s.displayPriority,
        rank: s.rank,
        name: s.candidate.name,
        order: s.priority,
      },
      geometry: s.candidate.geometry,
    })),
  };
}

/** Matched crashes in the current analysis (radius, period and filter applied). */
export function crashFeatures(pkg: SchoolPackage, result: AnalysisResult): FeatureCollection<{ injury: number; pedestrian: number; candidate: string }> {
  const members = new Set(result.candidates.map((s) => s.index));
  const { startDay } = periodWindow(pkg, result.config.periodYears);
  const c = pkg.crashes;
  const features: FeatureCollection<{ injury: number; pedestrian: number; candidate: string }>["features"] = [];
  for (let i = 0; i < c.candidate.length; i++) {
    const cand = c.candidate[i] as number;
    if (!members.has(cand) || (c.day[i] as number) < startDay) continue;
    const flags = c.flags[i] as number;
    if (!crashMatchesFilter(flags, result.config.crashFilter)) continue;
    features.push({
      type: "Feature",
      properties: { injury: flags & 1 ? 1 : 0, pedestrian: flags & 4 ? 1 : 0, candidate: pkg.candidates[cand]?.id ?? "" },
      geometry: { type: "Point", coordinates: [c.lon[i] as number, c.lat[i] as number] },
    });
  }
  return { type: "FeatureCollection", features };
}

export function boundsOfRing(ring: Position[]): [Position, Position] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return [
    [minX, minY],
    [maxX, maxY],
  ];
}

export function geometryBounds(geometry: { type: string; coordinates: unknown }): [Position, Position] {
  if (geometry.type === "Point") {
    const p = geometry.coordinates as Position;
    return [p, p];
  }
  return boundsOfRing(geometry.coordinates as Position[]);
}
