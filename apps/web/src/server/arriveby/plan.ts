import "server-only";

import { buildArrivalPlan, describeEntrance, JOURNEY_MODES, summarizeAvailability, type ArrivePreference, type JourneyMode, type OccupancyEvidence, type Observation, type ParkingCheckInput } from "@crossmetric/engine/commute";
import { ARRIVE_PREFERENCES, type ArrivalBasis, type ArriveByResponse } from "@/lib/arriveby-types";
import type { JourneyRequest } from "@/lib/journey-types";
import { within } from "../commute/plan";
import { getObservationStore } from "../commute/observations";
import { newCollector, planJourney } from "../journey/plan";
import { parseJourneyRequest } from "../journey/request";

const PLACE_ID = /^[a-z]{2,3}-[A-Za-z0-9]{2,12}$/;
const OBSERVATION_BUDGET_MS = 1500;
/** Community reports older than this are not evidence of anything. */
const REPORT_WINDOW_MS = 15 * 60_000;

export interface ArriveByRequest {
  journey: JourneyRequest & { timing: { mode: "arrive"; by: number } };
  prefer: ArrivePreference;
  preferredPlaceId: string | null;
}

export type ArriveByParse = { ok: true; value: ArriveByRequest } | { ok: false; error: string; field?: "origin" | "destination" | "timing" };

/**
 * Validate an untrusted ArriveBy request: the journey fields exactly as the journey API
 * checks them (Georgia only, explicit future time, preferences), with the arrival time as
 * the deadline. A time that has passed is rejected, never moved to another day.
 */
export function parseArriveByRequest(body: Record<string, unknown> | null, now: number): ArriveByParse {
  if (!body) return { ok: false, error: "Invalid request." };
  const by = typeof body.arriveBy === "number" && Number.isFinite(body.arriveBy) ? body.arriveBy : null;
  if (by === null) return { ok: false, error: "Choose when you need to be there.", field: "timing" };
  const parsed = parseJourneyRequest({ ...body, timing: { mode: "arrive", by } }, now);
  if (!parsed.ok) return parsed;
  const prefer = ARRIVE_PREFERENCES.includes(body.prefer as ArrivePreference) ? (body.prefer as ArrivePreference) : "best";
  const preferredPlaceId = typeof body.preferredPlaceId === "string" && PLACE_ID.test(body.preferredPlaceId) ? body.preferredPlaceId : null;
  return { ok: true, value: { journey: parsed.value as ArriveByRequest["journey"], prefer, preferredPlaceId } };
}

async function recentReports(now: number): Promise<Observation[]> {
  const read = async () => (await getObservationStore().recent(now - REPORT_WINDOW_MS)).filter((o) => o.verification !== "held");
  return within(read(), OBSERVATION_BUDGET_MS, [] as Observation[]);
}

function occupancyFor(reports: Observation[], placeId: string, now: number): OccupancyEvidence {
  const s = summarizeAvailability(reports, placeId, now);
  if (s.state === "none" || s.latestAt === null) return { kind: "none" };
  return { kind: "community", state: s.state, reports: s.reports, latestAt: s.latestAt };
}

/**
 * Plan an arrival: the journey planner's arrive-by options (routing, timetables, verified
 * parking rules), every campus parking place it checked, and the ArriveBy engine's single
 * decision on top. Nothing is stored. Occupancy comes only from recent community reports,
 * labelled as such; no live occupancy source exists for these campuses.
 */
export async function planArrival(req: ArriveByRequest, now: number = Date.now()): Promise<ArriveByResponse> {
  const collect = newCollector();
  const journey = await planJourney(req.journey, now, collect);
  const deadline = req.journey.timing.by;
  const campus = collect.campus;
  const building = collect.building;
  const mapDataDate = campus ? campus.data.bundle.osm.timestamp.slice(0, 10) : null;

  let parking: ParkingCheckInput[] | null = null;
  if (campus && building) {
    const reports = collect.parking.length ? await recentReports(now) : [];
    parking = collect.parking.map((p) => ({
      placeId: p.placeId,
      code: p.code,
      name: p.name,
      kind: p.kind,
      payment: p.payment,
      driveS: p.driveS,
      bufferMin: p.bufferMin,
      searchMin: p.searchMin,
      walkS: p.walkS,
      arriveAt: p.arriveAt,
      rules: p.rules,
      evaluation: p.evaluation,
      occupancy: occupancyFor(reports, p.placeId, now),
    }));
  }

  // Ways of travelling that produced no option, in plain words.
  const kinds = new Set(collect.ranked.map((o) => o.kind));
  const unavailable: { kind: JourneyMode; reason: string }[] = [];
  const modes = req.journey.prefs.modes;
  if (!kinds.has("transit") && modes.transit) unavailable.push({ kind: "transit", reason: journey.coverage.transitSummary ?? "No timetabled transit trip arrives in time" });
  if (!kinds.has("drive")) unavailable.push({ kind: "drive", reason: !req.journey.vehicle.hasCar ? "You said you don't have a car" : !modes.drive ? "Driving is turned off in your preferences" : building ? "No nearby parking your vehicle may use at that time" : "No driving route was found" });
  if (!kinds.has("walk")) unavailable.push({ kind: "walk", reason: modes.walk ? "Too far to walk, or no walking route was found" : "Walking is turned off in your preferences" });
  if (!kinds.has("bike")) unavailable.push({ kind: "bike", reason: modes.bike ? "No bike route was found" : "Biking is turned off in your preferences" });

  const destStatus = journey.coverage.transit.find((c) => c.reaches)?.status ?? null;
  const basis: ArrivalBasis = {
    deadline,
    destination: {
      label: journey.destination.label,
      buildingId: building?.id ?? null,
      entrance: building ? describeEntrance(collect.entrance, building.center, mapDataDate) : null,
    },
    options: collect.ranked,
    parking,
    sources: campus?.data.bundle.sources ?? {},
    vehicle: { hasCar: req.journey.vehicle.hasCar, permits: req.journey.vehicle.permits },
    campusCodes: campus ? campus.data.bundle.parking.map((p) => p.code) : [],
    campusName: campus?.data.bundle.name ?? null,
    accessible: req.journey.prefs.accessible,
    peak: collect.peak,
    weatherAvailable: collect.weather !== "unavailable",
    rideshare: journey.rideshare ? { driveMin: journey.rideshare.driveMin } : null,
    late: journey.late,
    unavailable: unavailable.filter((u) => JOURNEY_MODES.includes(u.kind)),
    transitStatus: destStatus,
    parkUntil: req.journey.parkUntil ?? null,
  };
  const plan = buildArrivalPlan({ ...basis, now, prefer: req.prefer, preferredPlaceId: req.preferredPlaceId });
  return {
    generatedAt: now,
    origin: journey.origin,
    destination: journey.destination,
    campus: campus?.id ?? null,
    plan,
    basis,
    coverage: { transit: journey.coverage.transit, transitSummary: journey.coverage.transitSummary },
    notes: journey.notes,
    mapDataDate,
  };
}
