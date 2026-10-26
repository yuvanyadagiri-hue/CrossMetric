/**
 * Shapes shared by the ArriveBy API (server) and the app (client).
 * Pure types only — safe to import anywhere.
 */
import type { ArrivalPlan, ArrivalPlanInput, ArrivePreference } from "@crossmetric/engine/commute";
import type { CampusId } from "./commute-types";
import type { JourneyOption, JourneyPlace, TransitCoverage } from "./journey-types";

/**
 * Everything the plan was built from, except the choices the person can change on the
 * spot (preferred way, preferred place) and the clock. The app re-runs the same engine
 * function on it, so switching "Drive" / "Transit" or choosing another lot is instant.
 * Options are the planner's ranked options, unchanged.
 */
export type ArrivalBasis = Omit<ArrivalPlanInput, "now" | "prefer" | "preferredPlaceId" | "options" | "late"> & {
  options: JourneyOption[];
  late: { option: JourneyOption; lateMin: number } | null;
};

export interface ArriveByResponse {
  generatedAt: number;
  origin: JourneyPlace;
  destination: JourneyPlace;
  campus: CampusId | null;
  /** The plan for the preference in the request (the app recomputes it from `basis` as choices change). */
  plan: ArrivalPlan;
  basis: ArrivalBasis;
  coverage: { transit: TransitCoverage[]; transitSummary: string | null };
  /** Planner notes (a service is down, a weather alert). */
  notes: string[];
  /** Where the building, entrance and parking shapes come from (OpenStreetMap extract date). */
  mapDataDate: string | null;
}

export const ARRIVE_PREFERENCES: ArrivePreference[] = ["best", "drive", "transit", "walk", "bike", "park_ride"];
