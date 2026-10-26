import { checkTiming, DEFAULT_TRAVEL_PREFERENCES, JOURNEY_MODES, type JourneyMode, type Priority, type TravelPreferences, type TripTiming } from "@crossmetric/engine/commute";
import { isCampusId } from "@/lib/commute-types";
import type { JourneyPlace, JourneyRequest, PlaceSource } from "@/lib/journey-types";
import { inGeorgia, parseVehicle } from "../commute/api";

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : null);
const BUILDING = /^[wr]\d{1,12}$/;
const SOURCES: PlaceSource[] = ["address", "place", "current", "saved", "building", "school", "college", "map", "station"];
const PRIORITIES: Priority[] = ["balanced", "fastest", "cheapest", "least_walking", "fewest_transfers", "safety"];

export type ParseResult = { ok: true; value: JourneyRequest } | { ok: false; error: string; field?: "origin" | "destination" | "timing" };

function parsePlace(raw: unknown, which: "start" | "destination"): JourneyPlace | string {
  const p = (raw && typeof raw === "object" ? raw : null) as Record<string, unknown> | null;
  if (!p) return which === "start" ? "Choose where you are starting." : "Choose a destination.";
  const lon = num(p.lon);
  const lat = num(p.lat);
  if (lon === null || lat === null) return which === "start" ? "Choose where you are starting." : "Choose a destination.";
  if (!inGeorgia(lon, lat)) return `The ${which} must be in Georgia. CrossMetric plans trips within Georgia only.`;
  const campus = isCampusId(p.campus) ? p.campus : null;
  const buildingId = typeof p.buildingId === "string" && BUILDING.test(p.buildingId) && campus ? p.buildingId : null;
  const source = SOURCES.includes(p.source as PlaceSource) ? (p.source as PlaceSource) : "place";
  return { label: str(p.label, 100) || (which === "start" ? "Start" : "Destination"), sublabel: str(p.sublabel, 120), lon, lat, source, campus: buildingId ? campus : null, buildingId };
}

export function parsePreferences(raw: unknown): TravelPreferences {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const m = (r.modes && typeof r.modes === "object" ? r.modes : {}) as Record<string, unknown>;
  const modes = Object.fromEntries(JOURNEY_MODES.map((k) => [k, typeof m[k] === "boolean" ? (m[k] as boolean) : DEFAULT_TRAVEL_PREFERENCES.modes[k]])) as Record<JourneyMode, boolean>;
  const maxWalk = num(r.maxWalkMin);
  const maxTransfers = num(r.maxTransfers);
  const prefer = Array.isArray(r.prefer) ? JOURNEY_MODES.filter((k) => (r.prefer as unknown[]).includes(k)) : [];
  return {
    modes,
    maxWalkMin: maxWalk !== null && maxWalk >= 1 && maxWalk <= 120 ? Math.round(maxWalk) : null,
    maxTransfers: maxTransfers !== null && maxTransfers >= 0 && maxTransfers <= 4 ? Math.round(maxTransfers) : null,
    accessible: r.accessible === true,
    priority: PRIORITIES.includes(r.priority as Priority) ? (r.priority as Priority) : "balanced",
    prefer,
  };
}

function parseTiming(raw: unknown): TripTiming | null {
  const t = (raw && typeof raw === "object" ? raw : null) as Record<string, unknown> | null;
  if (!t) return null;
  if (t.mode === "now") return { mode: "now" };
  if (t.mode === "depart") return { mode: "depart", at: num(t.at) ?? Number.NaN };
  if (t.mode === "arrive") return { mode: "arrive", by: num(t.by) ?? Number.NaN };
  return null;
}

/**
 * Validate an untrusted journey request. Timing is required and explicit: a missing
 * timing is an error (never a default chosen by the server), and a time that has
 * passed is rejected rather than moved to another day.
 */
export function parseJourneyRequest(body: Record<string, unknown> | null, now: number): ParseResult {
  if (!body) return { ok: false, error: "Invalid request." };
  const origin = parsePlace(body.origin, "start");
  if (typeof origin === "string") return { ok: false, error: origin, field: "origin" };
  const destination = parsePlace(body.destination, "destination");
  if (typeof destination === "string") return { ok: false, error: destination, field: "destination" };
  if (Math.abs(origin.lon - destination.lon) < 1e-5 && Math.abs(origin.lat - destination.lat) < 1e-5) return { ok: false, error: "The start and destination are the same place.", field: "destination" };
  const timing = checkTiming(parseTiming(body.timing), now);
  if (!timing.ok) return { ok: false, error: timing.message, field: "timing" };
  const prefs = parsePreferences(body.prefs);
  if (!JOURNEY_MODES.some((m) => prefs.modes[m])) return { ok: false, error: "Turn on at least one way to travel." };
  const v = parseVehicle(body.vehicle);
  const fuel = num(body.fuelPrice);
  const walk = num(body.walkSpeedMps);
  // A stay end only means something for an arrival: within a week after it.
  const until = num(body.parkUntil);
  const by = timing.timing.mode === "arrive" ? timing.timing.by : null;
  const parkUntil = by !== null && until !== null && until > by + 5 * 60_000 && until < by + 7 * 86_400_000 ? until : null;
  return {
    ok: true,
    value: {
      origin,
      destination,
      timing: timing.timing,
      prefs,
      vehicle: { hasCar: v.hasCar, permits: v.permits, registered: v.registered, mpg: v.mpg },
      fuelPrice: fuel !== null && fuel > 0.5 && fuel < 15 ? fuel : null,
      walkSpeedMps: walk !== null && walk >= 0.5 && walk <= 2.5 ? walk : 1.25,
      ...(parkUntil ? { parkUntil } : {}),
    },
  };
}
