import { isGeorgiaPoint, type Place, type PlaceKind, type PlannerMode, PLANNER_MODES } from "./trip-types";

/**
 * Trips live in the URL so a link recreates them:
 *   /routes?from=-84.38630,33.78110,place,,Midtown%20Station&to=-84.39630,33.77560,college,139755,Georgia%20Tech&mode=walk
 * "My location" is never written to the URL (it would publish where someone is).
 */

const KINDS: PlaceKind[] = ["school", "college", "address", "place"];

export function encodePlace(p: Place): string | null {
  if (p.kind === "current") return null;
  return [p.lon.toFixed(5), p.lat.toFixed(5), p.kind, p.id ?? "", p.label.slice(0, 120)].join(",");
}

export function decodePlace(raw: string | null): Place | null {
  if (!raw) return null;
  const parts = raw.split(",");
  if (parts.length < 5) return null;
  const [lonS, latS, kindS, id, ...labelParts] = parts;
  const lon = Number(lonS);
  const lat = Number(latS);
  if (!isGeorgiaPoint(lon, lat)) return null;
  const kind = KINDS.find((k) => k === kindS) ?? "place";
  const label = labelParts.join(",").trim().slice(0, 120) || "Selected place";
  const place: Place = { lon, lat, kind, label };
  if (id && /^(\d{12}|\d{6})$/.test(id)) place.id = id;
  return place;
}

export function parseMode(raw: string | null, fallback: PlannerMode = "walk"): PlannerMode {
  return PLANNER_MODES.find((m) => m.id === raw)?.id ?? fallback;
}

export function tripHref(path: string, from: Place | null, to: Place | null, mode: PlannerMode): string {
  const params = new URLSearchParams();
  const f = from ? encodePlace(from) : null;
  const t = to ? encodePlace(to) : null;
  if (f) params.set("from", f);
  if (t) params.set("to", t);
  params.set("mode", mode);
  return `${path}?${params.toString()}`;
}

/** Place for an institution from the search index. */
export function institutionPlace(s: { id: string; name: string; lon: number; lat: number; type?: "k12" | "college"; city?: string | null }): Place {
  return {
    label: s.name,
    sublabel: s.city ? `${s.city}, GA` : "Georgia",
    lon: s.lon,
    lat: s.lat,
    kind: s.type === "college" ? "college" : "school",
    id: s.id,
  };
}
