import type { RouteBadge } from "./commute-types";

/** A station (rail platforms grouped) or a bus stop (both sides of a street grouped). */
export interface NearbyStation {
  id: string;
  name: string;
  kind: "rail" | "bus";
  network: "atlanta" | "athens";
  agencies: string[];
  lon: number;
  lat: number;
  /** Straight-line distance, metres. */
  straightM: number;
  /** Routed walking distance and time; null when walking routes are unavailable. */
  walkM: number | null;
  walkMin: number | null;
  routes: RouteBadge[];
  /** Scheduled departures in the next hour (timetable times, not live). */
  departures: { route: RouteBadge; headsign: string; time: number; headway: number }[];
  /** From the published GTFS data (MARTA publishes it; UGA and ACC Transit do not). */
  wheelchair: "yes" | "no" | "unknown";
  /** Station parking from MARTA's official page, when the station has parking. */
  parking: string | null;
}

export interface NearbyResponse {
  at: { lon: number; lat: number };
  generatedAt: number;
  stations: NearbyStation[];
  /** When no rail station is within walking reach: the nearest one and the drive to it. */
  nearestRail: { station: NearbyStation; driveMin: number | null; driveM: number | null } | null;
  /** Said when nothing is near: which agencies CrossMetric covers. */
  coverage: string | null;
  notes: string[];
  scheduledOnly: true;
}
