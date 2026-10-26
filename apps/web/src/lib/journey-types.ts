/**
 * Shapes shared by the journey API (server) and the app (client): a trip between
 * any two points in Georgia, with explicit timing and the person's preferences.
 * Pure types and tiny helpers only — safe to import anywhere.
 */
import type { JourneyMode, RoleId, TravelPreferences, TripTiming } from "@crossmetric/engine/commute";
import { timingKey } from "@crossmetric/engine/commute";
import type { CampusId, PlanLeg, PlanOption } from "./commute-types";

export type PlaceSource = "address" | "place" | "current" | "saved" | "building" | "school" | "college" | "map" | "station";

export interface JourneyPlace {
  label: string;
  sublabel?: string | null;
  lon: number;
  lat: number;
  source?: PlaceSource;
  /** Campus building destinations keep their campus rules (entrances, parking). */
  campus?: CampusId | null;
  buildingId?: string | null;
}

export interface JourneyVehicle {
  hasCar: boolean;
  permits: string[];
  registered: boolean | null;
  mpg: number | null;
}

export interface JourneyRequest {
  origin: JourneyPlace;
  destination: JourneyPlace;
  timing: TripTiming;
  prefs: TravelPreferences;
  vehicle: JourneyVehicle;
  fuelPrice: number | null;
  walkSpeedMps: number;
  /** Arrive-by only: when you will leave campus, so campus parking is checked for the whole stay. */
  parkUntil?: number | null;
}

export interface SafetySummary {
  score: number;
  band: string;
  mode: "walk" | "bike" | "drive";
  confidence: "high" | "moderate" | "limited";
  /** The most important concern, in plain words (from the CrossScore model). */
  concern: string | null;
}

export interface JourneyOption {
  id: string;
  kind: JourneyMode;
  title: string;
  /** Planned departure from the start and arrival at the destination (epoch ms). */
  leaveAt: number;
  arriveAt: number;
  durationMin: number;
  /** Minutes of planning buffer included (no live traffic, schedule slack). */
  bufferMin: number;
  distanceM: number | null;
  walkMin: number;
  waitMin: number;
  transfers: number;
  rides: number;
  costUsd: number | null;
  /** What the cost covers, or why it is unknown ("Fare $2.50", "Gas not included: add mpg"). */
  costNote: string;
  legs: PlanLeg[];
  /** Campus parking used by a drive (verified rule records). */
  parking: PlanOption["parking"] | null;
  /** Parking at the destination or station, when it is not a verified campus place. */
  parkingNote: string | null;
  safety: SafetySummary | null;
  access: "verified" | "unverified" | "not_applicable";
  accessNote: string | null;
  /** Times come from published timetables (never live vehicle positions). */
  scheduled: boolean;
  roles: RoleId[];
  explanation: string;
  notes: string[];
  signature: string;
}

export interface TransitCoverage {
  network: "atlanta" | "athens";
  agencies: string[];
  /** Whether the start and the destination are both within walking reach of this network's stops. */
  reaches: boolean;
  status: "scheduled" | "calendar_unconfirmed" | "modified" | "no_service" | "not_covered" | "unavailable";
  note: string | null;
}

export interface JourneyResponse {
  generatedAt: number;
  timing: TripTiming;
  timingLabel: string;
  origin: JourneyPlace;
  destination: JourneyPlace;
  /** Eligible options, best match first. */
  options: JourneyOption[];
  /** Options removed by your hard constraints, with the reasons. */
  excluded: { title: string; kind: JourneyMode; reasons: string[] }[];
  tradeoffs: string[];
  /** Arrive-by only: nothing arrives in time; the earliest arrival leaving now. */
  late: { option: JourneyOption; lateMin: number } | null;
  coverage: {
    transit: TransitCoverage[];
    transitSummary: string | null;
    safety: string | null;
  };
  /** Ride-hail hand-off: the driving time only; prices and pickup times are shown by the provider. */
  rideshare: { driveMin: number; distanceM: number } | null;
  notes: string[];
  toleranceMin: number;
}

export interface JourneyApiError {
  error: string;
  kind: "invalid" | "unavailable" | "no_route" | "data_missing" | "rate_limited";
  field?: "origin" | "destination" | "timing";
}

/** Labels for the travel kinds, used across the app. */
export const MODE_LABEL: Record<JourneyMode, string> = { walk: "Walk", bike: "Bike", transit: "Transit", drive: "Drive", park_ride: "Park & ride" };

const r5 = (v: number) => Math.round(v * 1e5) / 1e5;

/**
 * Everything that changes the answer, as one string. Results are shown as current
 * only while this key matches the inputs on screen.
 */
export function journeyKey(req: JourneyRequest): string {
  const place = (p: JourneyPlace) => (p.buildingId ? `b:${p.campus}:${p.buildingId}` : `${r5(p.lon)},${r5(p.lat)}`);
  const p = req.prefs;
  const modes = (Object.keys(p.modes) as JourneyMode[]).filter((m) => p.modes[m]).sort().join("+");
  return [
    place(req.origin),
    place(req.destination),
    timingKey(req.timing),
    modes,
    p.maxWalkMin ?? "-",
    p.maxTransfers ?? "-",
    p.accessible ? "acc" : "",
    p.priority,
    [...p.prefer].sort().join("+"),
    req.vehicle.hasCar ? "car" : "nocar",
    req.vehicle.permits.join("+"),
    String(req.vehicle.registered),
    req.vehicle.mpg ?? "-",
    req.fuelPrice ?? "-",
    req.walkSpeedMps,
    // Only present when set, so keys for ordinary searches are unchanged.
    ...(req.parkUntil ? [`until:${Math.round(req.parkUntil / 60_000)}`] : []),
  ].join("|");
}
