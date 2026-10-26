import type { ClassOccurrence, JourneyMode, TripTiming } from "@crossmetric/engine/commute";
import type { Building, CampusBundle, CampusId, CommuteApiError, LonLat, ParkingResult, PlanResponse } from "@/lib/commute-types";
import type { ActiveTrip, CommutePrefs, ParkedCar, SavedPlace, StoredSchedule, TripOptionLike } from "@/lib/commute-store";
import type { JourneyPlace } from "@/lib/journey-types";
import type { Snap } from "./BottomSheet";
import type { useParking } from "./hooks";
import type { PickResult } from "./PlacePicker";
import type { NearbyState } from "./panels/NearbyPanel";
import type { ArriveBy } from "./useArriveBy";
import type { CommunityReports, ReportFlow } from "./useCommunity";
import type { Journey } from "./useJourney";

export type View =
  | { kind: "home" }
  | { kind: "services" }
  | { kind: "activity" }
  | { kind: "receipt"; id: string }
  | { kind: "safety" }
  | { kind: "help" }
  | { kind: "search"; target: PickTarget }
  | { kind: "arrived" }
  | { kind: "plan" }
  | { kind: "arrive" }
  | { kind: "detail" }
  | { kind: "nearby"; stationId?: string | null }
  | { kind: "saved"; editId?: string | null }
  | { kind: "profile" }
  | { kind: "prefs" }
  | { kind: "parking"; placeId?: string | null }
  | { kind: "night" }
  | { kind: "trip" }
  | { kind: "parked" }
  | { kind: "return" }
  | { kind: "stop"; stop: { id: string; name: string; lon: number; lat: number } }
  | { kind: "schedule" }
  | { kind: "report" }
  | { kind: "community"; reportId?: string | null };

export type SearchIntent = JourneyMode | "rideshare" | null;

/**
 * The four destinations (Explore, Routes, Report, Community), plus Account, which lives in the
 * Explore header on a phone and at the foot of the rail on a desktop.
 */
export type Tab = "explore" | "routes" | "report" | "community" | "account";

export function tabOf(v: View): Tab {
  switch (v.kind) {
    case "plan":
    case "detail":
    case "trip":
    case "arrived":
    case "arrive":
    case "activity":
    case "receipt":
      return "routes";
    case "report":
      return "report";
    case "community":
      return "community";
    case "profile":
    case "prefs":
    case "schedule":
    case "saved":
    case "help":
      return "account";
    default:
      return "explore";
  }
}

/** What the Arrived page shows about a trip that just ended (labels and times only). */
export interface ArrivedSummary {
  title: string;
  kind: string;
  from: string | null;
  to: string;
  plannedMin: number;
  tookMin: number;
  costUsd: number | null;
  steps: number;
  endedAt: number;
}

export interface PlanState {
  plan: PlanResponse | null;
  loading: boolean;
  error: CommuteApiError | null;
  updatedAt: number | null;
  cached: boolean;
  refresh: () => void;
}

/** What the place picker is choosing for. */
/** "start" sets the saved commute start used for class plans. */
/** "arrive" picks the ArriveBy destination (a campus building first). */
/** "report" finds the place a barrier report is about. */
export type PickTarget = "destination" | "origin" | "nearby" | "save" | "start" | "arrive" | "report";

/**
 * Parking timing is its own thing: when you arrive at the lot and how long you stay.
 * It never sets the time of a route search, and a route search never sets it.
 */
export interface ParkingTiming {
  /** Arrival at the lot; null means now. */
  at: number | null;
  /** End of the stay, when chosen (or suggested from today's classes for a class trip). */
  until: number | null;
  untilSource: "chosen" | "class" | null;
}

export interface AppModel {
  now: number;
  online: boolean;
  reducedMotion: boolean;
  prefs: CommutePrefs;
  setPrefs: (next: CommutePrefs | ((p: CommutePrefs) => CommutePrefs)) => void;
  /** Optional campus context (Georgia Tech or UGA): buildings, campus parking, night services. */
  campus: CampusId | null;
  setCampus: (c: CampusId | null) => void;
  bundle: CampusBundle | null;
  bundleError: string | null;
  buildings: Map<string, Building>;
  schedule: StoredSchedule;
  setSchedule: (next: StoredSchedule | ((s: StoredSchedule) => StoredSchedule)) => void;
  occurrences: ClassOccurrence[];
  nextClass: ClassOccurrence | null;
  /** The plan for the next class (arrive-by its start): shown on its own card, never used for other searches. */
  classPlan: PlanState;
  journey: Journey;
  /** ArriveBy: "be at this building by this time" — its inputs and plan. */
  arrive: ArriveBy;
  /** Open ArriveBy, optionally with a destination and arrival time chosen elsewhere (a class, an arrive-by search). */
  openArrive: (prefill?: { destination?: JourneyPlace; arriveBy?: number }) => void;
  nearby: NearbyState;
  /** The destination, when it is a building on the current campus. */
  destBuilding: Building | null;
  /** The saved commute start (used for class plans and offered as a start). */
  origin: SavedPlace | null;
  setOrigin: (p: SavedPlace | null, source: "saved" | "current" | "chosen") => void;
  locate: () => Promise<LonLat | null>;
  locating: boolean;
  locError: string | null;
  userLocation: LonLat | null;
  locationPermission: "granted" | "denied" | "prompt" | "unknown";
  /** A JourneyPlace for the person's current location (asks for it when needed). */
  currentPlace: () => Promise<JourneyPlace | null>;
  parkingTiming: ParkingTiming;
  setParkingTiming: (t: ParkingTiming) => void;
  /** Kept for panels that read the stay end directly. */
  parkUntil: number | null;
  view: View;
  /** Open a screen: a real route (its URL), with the size its sheet opens at. `replace` swaps the current entry instead of adding one. */
  go: (v: View, snap?: Snap, replace?: boolean) => void;
  /** One step back inside the app (the browser's Back), or up to the parent screen when the page was opened directly. */
  back: () => void;
  snap: Snap;
  setSnap: (s: Snap) => void;
  /** Open the search page for a destination, a start, a place to look near, or a place to save. */
  openPicker: (target: PickTarget) => void;
  /** Leave the search page without choosing anything. */
  closeSearch: () => void;
  /** The result of the search page: a place, a typed request, or "choose on map". */
  pickResult: (target: PickTarget, r: PickResult) => void;
  /** The trip in progress, if any. */
  trip: ActiveTrip | null;
  setTrip: (t: ActiveTrip | null) => void;
  /** The summary of the trip that just finished (shown on the Arrived page). */
  arrived: ArrivedSummary | null;
  clearArrived: () => void;
  /** Campus parking for the parking screens (loaded only while they are open). */
  parkingView: { state: ReturnType<typeof useParking>; results: Map<string, ParkingResult>; near: [number, number] | null };
  /** "Choose on map" for a start or destination. */
  pickOnMap: (target: "origin" | "destination") => void;
  parked: ParkedCar | null;
  setParked: (c: ParkedCar | null) => void;
  startTrip: (o: TripOptionLike, extra?: { campus?: CampusId | null; buildingId?: string; destLabel?: string; fromLabel?: string; occurrenceKey?: string | null }) => void;
  /** Plan a trip to a place now (a new search: Leave now). */
  planTo: (dest: JourneyPlace) => void;
  /** Open search for a destination, offering only this way of travelling (Services tiles); "rideshare" lists the ride-hail hand-off first. */
  searchFor: (mode: SearchIntent) => void;
  /** What the current search was started for (a Services tile), if anything. */
  searchIntent: SearchIntent;
  /** The time chosen on Home ("Now" or a later departure/arrival) for the next search. */
  homeTiming: TripTiming;
  setHomeTiming: (t: TripTiming) => void;
  /** Finish the active trip: completed (arrived) or ended early. Recorded in Activity when history is on. */
  endTrip: (completed: boolean) => void;
  /** Map basemap: dark (brand default) or following the appearance. */
  mapTheme: "light" | "dark";
  toast: (message: string) => void;
  /** "desktop": rail and side panel beside a wide map (1024 px and up); "mobile": map, sheet and tab bar. */
  layout: "desktop" | "mobile";
  /** Community barrier reports (shared, from the server). */
  community: CommunityReports;
  /** The barrier report being written. */
  report: ReportFlow;
  /** Where the report pin is while its location is chosen (the map centre), with the nearest address once looked up. */
  reportPin: { lon: number; lat: number; label: string | null; resolving: boolean } | null;
  /** Move the map to a point. */
  flyTo: (p: LonLat) => void;
  /** Open the report flow, optionally at a place (it then starts at "What's the barrier?"). */
  openReport: (at?: { lon: number; lat: number; label: string | null }) => void;
}
