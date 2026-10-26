import type { LonLat, PlannedRoute } from "@/lib/trip-types";
import { ROUTE_COLORS } from "@/components/map/mapUtils";

/**
 * Static route thumbnail drawn from the route's real geometry (no map tiles):
 * the line, its condition highlights, and start / destination points.
 */
export function RoutePreview({ route, others = [], width = 132, height = 96, className = "" }: { route: PlannedRoute; others?: PlannedRoute[]; width?: number; height?: number; className?: string }) {
  const all = [route, ...others].flatMap((r) => r.geometry);
  if (all.length < 2) return null;
  const lat0 = all[0]![1];
  const k = Math.cos((lat0 * Math.PI) / 180);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [lon, lat] of all) {
    const x = lon * k;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, lat);
    maxY = Math.max(maxY, lat);
  }
  const pad = 12;
  const scale = Math.min((width - pad * 2) / Math.max(maxX - minX, 1e-6), (height - pad * 2) / Math.max(maxY - minY, 1e-6));
  const ox = (width - (maxX - minX) * scale) / 2;
  const oy = (height - (maxY - minY) * scale) / 2;
  const project = ([lon, lat]: LonLat) => [ox + (lon * k - minX) * scale, height - (oy + (lat - minY) * scale)] as const;
  const path = (pts: LonLat[]) => pts.map((p, i) => `${i ? "L" : "M"}${project(p)[0].toFixed(1)},${project(p)[1].toFixed(1)}`).join("");
  const start = project(route.geometry[0]!);
  const end = project(route.geometry[route.geometry.length - 1]!);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className={`rounded-chip bg-[#eef2f6] ${className}`} aria-hidden>
      <path
        d={[...Array.from({ length: Math.ceil(width / 12) }, (_, i) => `M${i * 12},0V${height}`), ...Array.from({ length: Math.ceil(height / 12) }, (_, i) => `M0,${i * 12}H${width}`)].join("")}
        stroke="#e1e7ee"
        strokeWidth="1"
      />
      {others.map((o) => (
        <path key={o.id} d={path(o.geometry)} fill="none" stroke={ROUTE_COLORS.alternative} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
      ))}
      <path d={path(route.geometry)} fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <path d={path(route.geometry)} fill="none" stroke={ROUTE_COLORS.selected} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      {route.segments
        .filter((s) => s.level !== "lower")
        .map((s, i) => (
          <path key={i} d={path(s.coords)} fill="none" stroke={s.level === "elevated" ? ROUTE_COLORS.elevated : ROUTE_COLORS.moderate} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
        ))}
      <circle cx={start[0]} cy={start[1]} r="4.5" fill="#fff" stroke="#15191E" strokeWidth="2.5" />
      <circle cx={end[0]} cy={end[1]} r="5" fill="#23744A" stroke="#fff" strokeWidth="2" />
    </svg>
  );
}
