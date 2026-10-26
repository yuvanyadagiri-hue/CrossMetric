import { NextResponse, type NextRequest } from "next/server";
import { isGeorgiaPoint, type Place } from "@/lib/trip-types";
import { geocode } from "@/server/geocode";
import { searchInstitutions } from "@/server/institutions";
import { searchStations } from "@/server/journey/stations";

/**
 * GET /api/places?q=georgia tech — schools and colleges CrossMetric analyzes,
 * transit stations, then Georgia addresses and places (OpenStreetMap via Photon).
 * Optional `near=lon,lat` biases (never filters) address results; it is rounded to
 * one decimal (about 10 km) so the request carries no precise location.
 */
export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") ?? "").slice(0, 160).trim();
  if (q.length < 2) return NextResponse.json({ query: q, results: [] });
  const nearRaw = (request.nextUrl.searchParams.get("near") ?? "").split(",").map(Number);
  const near: [number, number] | null = nearRaw.length === 2 && nearRaw.every(Number.isFinite) && isGeorgiaPoint(nearRaw[0]!, nearRaw[1]!) ? [Math.round(nearRaw[0]! * 10) / 10, Math.round(nearRaw[1]! * 10) / 10] : null;
  const [hits, stations, places] = await Promise.all([
    searchInstitutions(q, 5),
    searchStations(q, 3),
    q.length >= 3 ? geocode(q, 5, near).catch(() => null) : Promise.resolve([] as Place[]),
  ]);
  const institutions: Place[] = hits.map((h) => ({
    label: h.school.name,
    sublabel: [h.school.type === "college" ? "College" : (h.school.level ?? "School"), h.school.city ? `${h.school.city}, GA` : "GA"].join(" · "),
    lon: h.school.lon,
    lat: h.school.lat,
    kind: h.school.type === "college" ? "college" : "school",
    id: h.school.id,
  }));
  // Drop geocoder hits that duplicate an institution already listed.
  const names = new Set([...institutions, ...stations].map((i) => i.label.toLowerCase()));
  const others = (places ?? []).filter((p) => !names.has(p.label.toLowerCase()));
  // A query that names a station ("… station", "MARTA …") lists stations first.
  const stationFirst = /\b(station|stn|marta|train|rail)\b/i.test(q);
  const ordered = stationFirst ? [...stations, ...institutions, ...others] : [...institutions, ...stations, ...others];
  return NextResponse.json({ query: q, results: ordered.slice(0, 8), geocoder: places === null ? "unavailable" : "ok" });
}
