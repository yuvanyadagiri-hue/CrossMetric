import type { LineGeometry, PointGeometry } from "./types";

const EARTH_RADIUS_M = 6_371_008.8;

/**
 * Local equirectangular projection around a reference latitude. Over the
 * ~1 km scale of one school analysis the error is far below a meter, which is
 * plenty for "are these two candidates within 100 m of each other?".
 */
export function localProjector(refLat: number) {
  const k = Math.cos((refLat * Math.PI) / 180);
  return ([lon, lat]: [number, number]): [number, number] => [
    ((lon * Math.PI) / 180) * EARTH_RADIUS_M * k,
    ((lat * Math.PI) / 180) * EARTH_RADIUS_M,
  ];
}

type XY = [number, number];

function pointSegmentDistance(p: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  const x = a[0] + t * dx - p[0];
  const y = a[1] + t * dy - p[1];
  return Math.hypot(x, y);
}

function vertices(g: PointGeometry | LineGeometry, project: (c: [number, number]) => XY): XY[] {
  return g.type === "Point" ? [project(g.coordinates)] : g.coordinates.map(project);
}

function pointToPath(p: XY, path: XY[]): number {
  if (path.length === 1) return Math.hypot(p[0] - path[0]![0], p[1] - path[0]![1]);
  let best = Infinity;
  for (let i = 1; i < path.length; i++) best = Math.min(best, pointSegmentDistance(p, path[i - 1]!, path[i]!));
  return best;
}

/** Minimum distance in meters between two candidate geometries (vertex-to-path; exact for points). */
export function geometryDistanceM(a: PointGeometry | LineGeometry, b: PointGeometry | LineGeometry, refLat: number): number {
  const project = localProjector(refLat);
  const va = vertices(a, project);
  const vb = vertices(b, project);
  let best = Infinity;
  for (const p of va) best = Math.min(best, pointToPath(p, vb));
  for (const p of vb) best = Math.min(best, pointToPath(p, va));
  return best;
}
