/**
 * Shapes shared by the commute API (server) and the commuter app (client).
 * Pure types and tiny helpers only — safe to import anywhere.
 */
import type { EligibilityStatus, WeatherState } from "@crossmetric/engine/commute";

export type CampusId = "gt" | "uga";
export const CAMPUS_IDS: CampusId[] = ["gt", "uga"];
export function isCampusId(v: unknown): v is CampusId {
  return v === "gt" || v === "uga";
}

export type LonLat = [number, number];

export interface SourceRef {
  id: string;
  title: string;
  url: string;
  kind: "official" | "news" | "osm";
  retrieved: string;
  reviewBy: string;
}

export interface Entrance {
  lon: number;
  lat: number;
  kind: "main" | "door";
  wheelchair: "yes" | "no" | "limited" | null;
  label: string | null;
}

export interface Building {
  id: string;
  name: string;
  aliases: string[];
  ref: string | null;
  center: LonLat;
  outline: LonLat[][][];
  entrances: Entrance[];
}

export interface ParkingPlaceInfo {
  id: string;
  code: string;
  name: string;
  label: string | null;
  kind: "deck" | "lot";
  center: LonLat;
  polygons: LonLat[][][];
  payment: string | null;
  parkAndRide: boolean;
  /** OpenStreetMap objects the shape comes from. */
  osm: string[];
}

export interface ServiceWindow {
  days: number[];
  start: string;
  end: string;
}

export interface NightService {
  id: string;
  name: string;
  kind: "on_demand" | "info" | "tracker" | "transit" | "discount_rideshare";
  summary: string;
  eligibility?: string;
  windows?: ServiceWindow[];
  exceptions?: string;
  pickup?: string;
  limits?: string[];
  routes?: string[];
  handoffs: { label: string; url: string }[];
  sourceId: string;
}

export interface HelpContact {
  label: string;
  detail: string;
  phone: string;
  display: string;
  sourceId: string;
}

export interface FeedInfo {
  id: string;
  name: string;
  tracker: string;
  fileDate: string;
}

export interface CampusBundle {
  id: CampusId;
  name: string;
  shortName: string;
  city: string;
  center: LonLat;
  bounds: [LonLat, LonLat];
  sources: Record<string, SourceRef>;
  buildings: Building[];
  parking: ParkingPlaceInfo[];
  parkingNotes: string[];
  night: NightService[];
  help: HelpContact[];
  transit: {
    feeds: FeedInfo[];
    notIncluded: { name: string; reason: string; url: string }[];
    trackers: { agency: string; url: string }[];
  };
  osm: { timestamp: string; attribution: string };
}

export interface VehicleInput {
  permits: string[];
  registered: boolean | null;
}

export interface AvailabilityView {
  state: "opening" | "full" | "conflicting" | "none";
  reports: number;
  latestAt: number | null;
  label: string;
}

export interface ParkingResult {
  placeId: string;
  /** "stay" when a park-until time was given (full-stay check); "now" otherwise. */
  mode: "stay" | "now";
  status: EligibilityStatus;
  price: number | null;
  reason: string;
  usableUntil: number | null;
  nextChange: { at: number; status: EligibilityStatus; reason: string } | null;
  walkMin: number | null;
  availability: AvailabilityView;
  sourceIds: string[];
  reviewBy: string;
}

export interface ParkingResponse {
  campus: CampusId;
  at: number;
  until: number | null;
  results: ParkingResult[];
  notes: string[];
}

export type OptionKind = "walk" | "drive" | "transit" | "park_ride";

export interface RouteBadge {
  short: string;
  long: string;
  color: string;
  text: string;
  agency: string;
}

export interface PlanLeg {
  kind: "walk" | "drive" | "park" | "wait" | "ride";
  from: string;
  to: string;
  depart: number | null;
  arrive: number | null;
  minutes: number;
  /** Measured length in metres, when known (routed walking, driving, transit shape). */
  meters?: number;
  geometry: LonLat[];
  route?: RouteBadge;
  headsign?: string;
  stops?: number;
  /** Seconds between buses for frequency-based service (times are approximate). */
  headway?: number;
  fromStop?: { id: string; name: string; lon: number; lat: number };
  toStop?: { id: string; name: string; lon: number; lat: number };
  parkingPlaceId?: string;
  steps?: { instruction: string; meters: number }[];
  note?: string;
}

export interface PlanOption {
  id: string;
  kind: OptionKind;
  title: string;
  leaveBy: number | null;
  arriveAt: number | null;
  arriveIfNow: number | null;
  minutes: number;
  bufferMin: number;
  costUsd: number | null;
  costMissing: string[];
  outdoorMin: number;
  rides: number;
  restriction: string | null;
  legs: PlanLeg[];
  parking: { placeId: string; status: EligibilityStatus; price: number | null; reason: string; usableUntil: number | null } | null;
  rainBadgeMin: number | null;
  notes: string[];
  role: "recommended" | "cheapest" | "lessRain" | "backup" | null;
}

export interface PlanResponse {
  generatedAt: number;
  deadline: number;
  recommended: PlanOption | null;
  alternatives: PlanOption[];
  late: { option: PlanOption; arriveAt: number; lateMin: number } | null;
  status: {
    transit: "scheduled" | "calendar_unconfirmed" | "modified" | "no_service" | "not_covered";
    transitNote: string | null;
    weather: WeatherState;
    notes: string[];
  };
  destination: { buildingId: string; name: string; entrance: Entrance | null; entranceVerified: boolean };
}

export interface PlanRequest {
  campus: CampusId;
  origin: { lon: number; lat: number; label: string };
  buildingId: string;
  /** Epoch ms: be at the entrance by this time (class start minus entry buffer). */
  deadline: number;
  parkUntil: number | null;
  vehicle: VehicleInput & { hasCar: boolean; mpg: number | null };
  fuelPrice: number | null;
  walkSpeedMps: number;
  modes: OptionKind[];
  /** Drive to this parking place (from the parking sheet's Directions). */
  parkAt?: string | null;
  /** Plan to a point instead of a building (e.g. back to the parked car); walk and transit only. */
  toPoint?: { lon: number; lat: number; label: string } | null;
  /** Transit only: the last departure today that still reaches the destination. */
  lastService?: boolean;
}

export interface WeatherView {
  state: WeatherState;
  avgMmPerHour: number | null;
  pop: number | null;
  updatedAt: number | null;
  alerts: { event: string; headline: string; severity: string; ends: string | null; url: string }[];
}

export interface StopArrival {
  route: RouteBadge;
  headsign: string;
  time: number;
  headway: number;
}

export interface StopView {
  id: string;
  name: string;
  lon: number;
  lat: number;
  arrivals: StopArrival[];
  scheduledOnly: true;
  calendarNote: string | null;
}

export interface CommuteApiError {
  error: string;
  kind: "invalid" | "unavailable" | "data_missing" | "rate_limited" | "no_route";
}
