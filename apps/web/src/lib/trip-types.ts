/**
 * Shapes shared by the trip API (server) and the trip UI (client).
 * Pure types and tiny helpers only — safe to import anywhere.
 */
import type { CrossScoreResult, CurbScore, RouteRole, TravelMode } from "@crossmetric/engine";

export type LonLat = [number, number];

/** Modes a person can pick. Rideshare is routed and scored as driving; the ride itself is booked with a provider. */
export type PlannerMode = "walk" | "bike" | "transit" | "drive" | "rideshare";

export const PLANNER_MODES: { id: PlannerMode; label: string }[] = [
  { id: "walk", label: "Walk" },
  { id: "bike", label: "Bike" },
  { id: "transit", label: "Transit" },
  { id: "drive", label: "Drive" },
  { id: "rideshare", label: "Rideshare" },
];

export function routedMode(mode: PlannerMode): TravelMode | null {
  if (mode === "walk" || mode === "bike" || mode === "drive") return mode;
  if (mode === "rideshare") return "drive";
  return null;
}

export type PlaceKind = "school" | "college" | "address" | "place" | "current" | "station";

export interface Place {
  label: string;
  sublabel?: string;
  lon: number;
  lat: number;
  kind: PlaceKind;
  /** NCES school id or IPEDS unit id for institutions. */
  id?: string;
}

export type SegmentLevel = "lower" | "moderate" | "elevated";

export interface RouteSegment {
  level: SegmentLevel;
  coords: LonLat[];
  reason: string;
}

export interface Hotspot {
  lon: number;
  lat: number;
  label: string;
  crashes: number;
  injury: number;
  pedestrian: number;
  bicyclist: number;
}

export interface PlannedRoute {
  id: string;
  roles: RouteRole[];
  mode: TravelMode;
  lengthM: number;
  durationS: number;
  geometry: LonLat[];
  crossScore: CrossScoreResult;
  segments: RouteSegment[];
  hotspots: Hotspot[];
  /** Main streets used, in order. */
  via: string[];
  /** How this alternative was generated (default routing, infrastructure preference, hotspot avoidance). */
  strategy: "default" | "infrastructure" | "avoid-hotspots" | "alternate";
  /** Crashes along the route that happened at dawn, dusk or in the dark. */
  lowLightCrashes: number;
}

export interface TripResult {
  from: Place;
  to: Place;
  mode: TravelMode;
  routes: PlannedRoute[];
  notes: string[];
  dataWindow: { start: string; end: string };
  generatedAt: string;
}

export interface ModeSummary {
  mode: PlannerMode | "schoolBus" | "shuttle";
  available: boolean;
  lengthM?: number;
  durationS?: number;
  score?: number;
  band?: CrossScoreResult["band"];
  summary: string;
  /** Short explanation when the mode can't be calculated. */
  unavailableReason?: string;
  nearbyStops?: { name: string; routes: string[]; rail: boolean; walkM: number }[];
}

export interface ModeComparison {
  from: Place;
  to: Place;
  modes: ModeSummary[];
  generatedAt: string;
}

export interface CurbOption {
  id: string;
  lon: number;
  lat: number;
  street: string;
  walkM: number;
  current: boolean;
  score: CurbScore;
  reasons: string[];
}

export interface CurbResult {
  purpose: "pickup" | "dropoff";
  around: Place;
  options: CurbOption[];
  recommendedId: string | null;
  generatedAt: string;
}

export interface ApiError {
  error: string;
  kind: "invalid" | "no_route" | "unavailable" | "data_missing";
}

export function formatDuration(seconds: number): string {
  const m = Math.max(1, Math.round(seconds / 60));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} hr ${rest} min` : `${h} hr`;
}

export function formatDistance(meters: number): string {
  const miles = meters / 1609.344;
  if (miles < 0.1) return `${Math.max(10, Math.round((meters * 3.28084) / 10) * 10)} ft`;
  return `${miles < 9.95 ? miles.toFixed(1) : Math.round(miles)} mi`;
}

export function isGeorgiaPoint(lon: number, lat: number): boolean {
  return Number.isFinite(lon) && Number.isFinite(lat) && lon >= -85.65 && lon <= -80.8 && lat >= 30.33 && lat <= 35.03;
}
