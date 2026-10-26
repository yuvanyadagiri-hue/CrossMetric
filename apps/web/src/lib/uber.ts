/**
 * Uber ride-request handoff: builds Uber's documented universal link so a
 * rider continues into Uber with pickup and destination already set. Uber —
 * not CrossMetric — shows prices, checks availability and account
 * eligibility, and confirms the ride.
 *
 * Format (Uber Developers, "Introduction to Deep Links", Universal Deep Links):
 *   https://m.uber.com/looking?client_id=<CLIENT_ID>&pickup=<Location>&drop[0]=<Location>
 * where each Location is a URL-encoded JSON object:
 *   { latitude, longitude, addressLine1 (nickname), addressLine2 (display address) }
 * https://developer.uber.com/docs/riders/ride-requests/tutorials/deep-links/introduction
 *
 * This is a link-based handoff only: no OAuth, no Riders API, no secrets. The
 * client ID is a public application identifier (it appears in every link) and
 * comes from NEXT_PUBLIC_UBER_CLIENT_ID. product_id and payment_method_id are
 * deliberately never sent: CrossMetric does not know them, and Uber lets the
 * rider choose.
 *
 * Pure functions, safe on server and client.
 */
import { isGeorgiaPoint, type Place } from "./trip-types";

export const UBER_UNIVERSAL_LINK = "https://m.uber.com/looking";

/** A stop as Uber expects it. Latitude and longitude are named, never positional. */
export interface UberStop {
  latitude: number;
  longitude: number;
  /** Shown in Uber as the place name (addressLine1). */
  name?: string;
  /** Shown in Uber after the name (addressLine2). Display only — it never moves the pin. */
  address?: string;
}

export type UberStopRole = "pickup" | "dropoff";

export interface UberLinkIssue {
  field: UberStopRole | "trip" | "config";
  message: string;
}

export type UberLinkResult = { ok: true; url: string } | { ok: false; issues: UberLinkIssue[] };

/** Where stops may be. Taking named latitude/longitude also catches swapped pairs. */
export interface UberServiceArea {
  name: string;
  contains: (latitude: number, longitude: number) => boolean;
}

/** CrossMetric covers Georgia; a lon/lat swap of a Georgia point lands far outside it. */
export const GEORGIA_AREA: UberServiceArea = { name: "Georgia", contains: (latitude, longitude) => isGeorgiaPoint(longitude, latitude) };

/** Longest name or address sent to Uber; matches the review form's maxLength. */
export const UBER_TEXT_MAX = 120;

/** Pickup and destination closer than this are treated as the same place. */
const SAME_PLACE_M = 25;

const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const PLACEHOLDER_PATTERN = /client[_-]?id|your|example|changeme|placeholder|^x+$/i;

/**
 * The configured public Uber client ID, or null when it is missing or still a
 * placeholder. `process.env.NEXT_PUBLIC_UBER_CLIENT_ID` is written out in full
 * so Next.js inlines it into the browser bundle.
 */
export function readUberClientId(raw: string | undefined = process.env.NEXT_PUBLIC_UBER_CLIENT_ID): string | null {
  const id = raw?.trim();
  if (!id || !CLIENT_ID_PATTERN.test(id) || PLACEHOLDER_PATTERN.test(id)) return null;
  return id;
}

/** Why a coordinate pair can't be used, or null when it can. */
export function coordinateProblem(latitude: unknown, longitude: unknown): string | null {
  if (typeof latitude !== "number" || typeof longitude !== "number" || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return "has no usable map position";
  }
  if (latitude < -90 || latitude > 90) return "has a latitude outside −90 to 90";
  if (longitude < -180 || longitude > 180) return "has a longitude outside −180 to 180";
  // 0,0 is a "no location" placeholder in many sources, not a real stop.
  if (latitude === 0 && longitude === 0) return "has no usable map position";
  return null;
}

/** Collapse whitespace, drop control characters and cap length. Empty → undefined. */
export function cleanUberText(text: string | undefined | null): string | undefined {
  if (!text) return undefined;
  const t = text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, UBER_TEXT_MAX).trim();
  return t || undefined;
}

/**
 * The display address CrossMetric actually knows for a place. Search results
 * carry it in `sublabel` after a category ("College · Atlanta, GA"); "My
 * location" only has an approximate "Near …" label, which is not an address.
 */
export function placeAddress(place: Place): string | undefined {
  if (place.kind === "current" || !place.sublabel) return undefined;
  const parts = place.sublabel.split(" · ");
  const address = parts[parts.length - 1]!.trim();
  return address && address !== "Georgia" && address !== "GA" ? cleanUberText(address) : undefined;
}

/**
 * Convert a CrossMetric place into an Uber stop. CrossMetric stores
 * `{ lon, lat }` (and `[lon, lat]` tuples in GeoJSON); Uber wants named
 * `latitude` / `longitude`, so the mapping is explicit here and nowhere else.
 */
export function stopFromPlace(place: Place): UberStop {
  return { latitude: place.lat, longitude: place.lon, name: cleanUberText(place.label), address: placeAddress(place) };
}

function metersBetween(a: UberStop, b: UberStop): number {
  const r = 6_371_000;
  const toRad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * toRad;
  const dLon = (b.longitude - a.longitude) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * toRad) * Math.cos(b.latitude * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** ~0.1 m precision; also normalises -0. */
function roundCoord(v: number): number {
  return Number(v.toFixed(6)) + 0;
}

/** Uber's Location object. Key order follows Uber's documented example. */
function locationJson(stop: UberStop): string {
  const location: { latitude: number; longitude: number; addressLine1?: string; addressLine2?: string } = {
    latitude: roundCoord(stop.latitude),
    longitude: roundCoord(stop.longitude),
  };
  const name = cleanUberText(stop.name);
  const address = cleanUberText(stop.address);
  if (name) location.addressLine1 = name;
  if (address && address !== name) location.addressLine2 = address;
  return JSON.stringify(location);
}

const LABEL: Record<UberStopRole, string> = { pickup: "Pickup", dropoff: "Destination" };

/** Every reason the trip can't be handed to Uber yet (empty when it can). */
export function uberLinkIssues(input: { pickup: UberStop | null; dropoff: UberStop | null; clientId: string | null; area?: UberServiceArea | null }): UberLinkIssue[] {
  const area = input.area === undefined ? GEORGIA_AREA : input.area;
  const issues: UberLinkIssue[] = [];
  for (const role of ["pickup", "dropoff"] as const) {
    const stop = input[role];
    if (!stop) {
      issues.push({ field: role, message: `Choose a ${role === "pickup" ? "pickup" : "destination"} location.` });
      continue;
    }
    const problem = coordinateProblem(stop.latitude, stop.longitude);
    if (problem) issues.push({ field: role, message: `${LABEL[role]} ${problem}. Choose the location again.` });
    else if (area && !area.contains(stop.latitude, stop.longitude)) {
      issues.push({ field: role, message: `${LABEL[role]} is outside ${area.name}, which CrossMetric covers. Choose a location in ${area.name}.` });
    }
  }
  if (!issues.length && metersBetween(input.pickup!, input.dropoff!) < SAME_PLACE_M) {
    issues.push({ field: "trip", message: "Pickup and destination are the same place. Choose a different destination." });
  }
  if (!input.clientId) {
    issues.push({ field: "config", message: "Uber handoff is not configured on this CrossMetric site: no Uber client ID is set (NEXT_PUBLIC_UBER_CLIENT_ID)." });
  }
  return issues;
}

/**
 * Build the Uber universal link. Stops must be inside `area` (Georgia unless
 * given; null skips the check). Values are percent-encoded with
 * encodeURIComponent (spaces as %20, exactly like Uber's documented example);
 * the parameter names are fixed literals.
 */
export function buildUberRideLink(input: { pickup: UberStop | null; dropoff: UberStop | null; clientId?: string | null; area?: UberServiceArea | null }): UberLinkResult {
  const clientId = input.clientId === undefined ? readUberClientId() : input.clientId ? readUberClientId(input.clientId) : null;
  const issues = uberLinkIssues({ pickup: input.pickup, dropoff: input.dropoff, clientId, area: input.area });
  if (issues.length) return { ok: false, issues };
  const params: [string, string][] = [
    ["client_id", clientId!],
    ["pickup", locationJson(input.pickup!)],
    ["drop[0]", locationJson(input.dropoff!)],
  ];
  const url = new URL(UBER_UNIVERSAL_LINK);
  url.search = params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  return { ok: true, url: url.toString() };
}
