import "server-only";

import type { Place } from "@/lib/trip-types";
import { isGeorgiaPoint } from "@/lib/trip-types";

/**
 * Address and place search, limited to Georgia.
 *
 * Default provider: Photon (photon.komoot.io), an OpenStreetMap geocoder that
 * is free for fair use. Set GEOCODER_URL to a self-hosted Photon for heavier
 * use. Queries are sent from the CrossMetric server and cached; the visitor's
 * IP address is never forwarded.
 */

const BASE = (process.env.GEOCODER_URL ?? "https://photon.komoot.io").replace(/\/$/, "");
const USER_AGENT = "CrossMetric/2.0 (Congressional App Challenge student project)";
const GEORGIA_BBOX = "-85.65,30.33,-80.8,35.03";
const CACHE_MAX = 500;
const cache = new Map<string, Promise<Place[]>>();

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    name?: string;
    housenumber?: string;
    street?: string;
    city?: string;
    district?: string;
    county?: string;
    state?: string;
    postcode?: string;
    osm_key?: string;
    osm_value?: string;
    type?: string;
  };
}

function toPlace(f: PhotonFeature): Place | null {
  const [lon, lat] = f.geometry.coordinates;
  const p = f.properties;
  if (!isGeorgiaPoint(lon, lat) || (p.state && p.state !== "Georgia" && p.state !== "GA")) return null;
  const address = [p.housenumber, p.street].filter(Boolean).join(" ");
  const label = p.name ?? (address || p.city);
  if (!label) return null;
  const locality = [p.name && address ? address : null, p.city ?? p.district ?? p.county, "GA"].filter(Boolean).join(", ");
  return { label, sublabel: locality, lon, lat, kind: p.housenumber || p.osm_key === "building" ? "address" : "place" };
}

/**
 * `near` biases results toward an area (rounded to about 10 km by the caller), so
 * "Five Points" near Atlanta finds Atlanta's before Athens's. It never filters.
 */
export async function geocode(query: string, limit = 6, near: [number, number] | null = null): Promise<Place[]> {
  const q = query.trim().slice(0, 160);
  if (q.length < 3) return [];
  const key = `${q.toLowerCase()}|${limit}|${near ? near.join(",") : ""}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const load = (async () => {
    const bias = near ? `&lon=${near[0]}&lat=${near[1]}&zoom=10&location_bias_scale=0.3` : "";
    const url = `${BASE}/api/?q=${encodeURIComponent(q)}&limit=${limit + 4}&lang=en&bbox=${GEORGIA_BBOX}${bias}`;
    const res = await fetch(url, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(8000), cache: "no-store" });
    if (!res.ok) throw new Error(`Geocoder error ${res.status}`);
    const json = (await res.json()) as { features: PhotonFeature[] };
    const seen = new Set<string>();
    const out: Place[] = [];
    for (const f of json.features) {
      const place = toPlace(f);
      if (!place) continue;
      const k = `${place.label}|${place.sublabel}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(place);
      if (out.length >= limit) break;
    }
    return out;
  })();
  cache.set(key, load);
  load.catch(() => cache.delete(key));
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  return load;
}

export async function reverseGeocode(lon: number, lat: number): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/reverse?lon=${lon.toFixed(5)}&lat=${lat.toFixed(5)}&lang=en`, {
      headers: { "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(6000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { features: PhotonFeature[] };
    const f = json.features[0];
    if (!f) return null;
    const p = f.properties;
    const street = [p.housenumber, p.street].filter(Boolean).join(" ");
    return street || p.name || p.city || null;
  } catch {
    return null;
  }
}
