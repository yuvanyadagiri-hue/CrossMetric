/**
 * Share links for a trip: `/?to=…[&from=…][&depart=…|&arrive=…]`.
 *
 * Privacy rules, enforced here rather than in the UI:
 * - "Current location" is never written into a link (it would publish where someone is).
 * - The start is included only when the person chooses to include it.
 * - Saved-place nicknames ("Home") are not shared; the place's own label is.
 * Opening a link plans the trip like a new search; a shared time that has passed is
 * not used (the trip opens as Leave now and says so), and nothing is ever moved to
 * another day.
 */
import { checkTiming, LEAVE_NOW, type TripTiming } from "@crossmetric/engine/commute";
import type { CampusId } from "./commute-types";
import type { JourneyPlace, PlaceSource } from "./journey-types";

const GA = { minLon: -85.65, maxLon: -80.8, minLat: 30.33, maxLat: 35.03 };
const SOURCES: PlaceSource[] = ["address", "place", "building", "school", "college", "map", "station"];
const CAMPUSES: CampusId[] = ["gt", "uga"];

export const inGeorgia = (lon: number, lat: number) => Number.isFinite(lon) && Number.isFinite(lat) && lon >= GA.minLon && lon <= GA.maxLon && lat >= GA.minLat && lat <= GA.maxLat;

/** "lon,lat,source,campus,buildingId,label" — the label last, so it may contain commas. */
export function encodeSharedPlace(p: JourneyPlace): string | null {
  if (p.source === "current") return null;
  const source = p.source && SOURCES.includes(p.source) ? p.source : "place";
  // A saved place's label is its address or place name; its nickname lives elsewhere and stays here.
  const label = p.label.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, 100) || "Shared place";
  const building = p.buildingId && p.campus ? [p.campus, p.buildingId] : ["", ""];
  return [p.lon.toFixed(5), p.lat.toFixed(5), source, ...building, label].join(",");
}

export function decodeSharedPlace(raw: string | null): JourneyPlace | null {
  if (!raw || raw.length > 400) return null;
  const parts = raw.split(",");
  if (parts.length < 6) return null;
  const [lonS, latS, sourceS, campusS, buildingS, ...labelParts] = parts;
  const lon = Number(lonS);
  const lat = Number(latS);
  if (!inGeorgia(lon, lat)) return null;
  // Labels are shown as text only; strip control characters and cap the length.
  const label = labelParts.join(",").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 100) || "Shared place";
  const source = SOURCES.find((s) => s === sourceS) ?? "place";
  const campus = CAMPUSES.find((c) => c === campusS) ?? null;
  const place: JourneyPlace = { label, lon, lat, source };
  // Same rule as the server (server/journey/request.ts): OpenStreetMap way or relation ids.
  if (campus && buildingS && /^[wr]\d{1,12}$/.test(buildingS)) {
    place.campus = campus;
    place.buildingId = buildingS;
  }
  return place;
}

export interface ShareInput {
  origin: JourneyPlace | null;
  destination: JourneyPlace;
  timing: TripTiming;
  includeStart: boolean;
}

/** The link for a trip, or null when there is nothing that may be shared. */
export function shareTripUrl(base: string, s: ShareInput): string | null {
  const to = encodeSharedPlace(s.destination);
  if (!to) return null;
  const params = new URLSearchParams({ to });
  const from = s.includeStart && s.origin ? encodeSharedPlace(s.origin) : null;
  if (from) params.set("from", from);
  if (s.timing.mode === "depart") params.set("depart", String(Math.round(s.timing.at / 60_000) * 60_000));
  if (s.timing.mode === "arrive") params.set("arrive", String(Math.round(s.timing.by / 60_000) * 60_000));
  return `${base.replace(/\/$/, "")}/?${params.toString()}`;
}

/** Whether the start can be offered for sharing (never the person's live location). */
export const canShareStart = (origin: JourneyPlace | null) => !!origin && origin.source !== "current";

export interface SharedTrip {
  destination: JourneyPlace;
  origin: JourneyPlace | null;
  timing: TripTiming;
  /** The link asked for a time that has passed (or was invalid); the trip opens as Leave now. */
  timingDropped: boolean;
}

export function readSharedTrip(params: URLSearchParams, now: number): SharedTrip | null {
  const destination = decodeSharedPlace(params.get("to"));
  if (!destination) return null;
  const origin = decodeSharedPlace(params.get("from"));
  const depart = Number(params.get("depart"));
  const arrive = Number(params.get("arrive"));
  const asked: TripTiming | null = params.has("depart") && Number.isFinite(depart) ? { mode: "depart", at: depart } : params.has("arrive") && Number.isFinite(arrive) ? { mode: "arrive", by: arrive } : null;
  if (!asked) return { destination, origin, timing: LEAVE_NOW, timingDropped: false };
  const check = checkTiming(asked, now);
  return check.ok ? { destination, origin, timing: check.timing, timingDropped: false } : { destination, origin, timing: LEAVE_NOW, timingDropped: true };
}

/** Query keys this module owns (removed from the address bar once read). */
export const SHARE_KEYS = ["to", "from", "depart", "arrive"] as const;
