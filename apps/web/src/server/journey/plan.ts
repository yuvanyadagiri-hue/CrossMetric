import "server-only";

import {
  applyConstraints,
  driveBufferMin,
  earliestArrival,
  isPeak,
  localMinutes,
  localWeekday,
  localDate,
  marginalTripCost,
  pickEntrance,
  PLANNING_DEFAULTS,
  rankOptions,
  rainWalk,
  timingLabel,
  transitBufferMin,
  type AccessPoint,
  type JourneyMode,
  type RankOption,
  type RideLeg,
  type TransitPlan,
  type WeatherState,
} from "@crossmetric/engine/commute";
import { routeOverlap as overlap } from "@crossmetric/engine";
import type { Building, CampusId, Entrance, LonLat, PlanLeg, PlanRequest, WeatherView } from "@/lib/commute-types";
import { tidyStopName } from "@/lib/names";
import type { JourneyOption, JourneyPlace, JourneyRequest, JourneyResponse, SafetySummary, TransitCoverage } from "@/lib/journey-types";
import { getCampus, type CampusData } from "../commute/data";
import { badge, driveCandidates, plannedTransit, rainFactorFor, straightM, transitLegs, walkLeg, within, type Built, type Ctx, type ParkingSeen } from "../commute/plan";
import { transitDay, type TransitDay } from "../commute/transit";
import { weatherFor } from "../commute/weather";
import { matrix, route, routeWithSteps, RoutingError } from "../valhalla";
import { ACCESS_RADIUS_M, agencyNames, EGRESS_RADIUS_M, martaStationParking, parkingRecordCurrent, reach, REGIONS } from "./networks";
import { streetSafety } from "./safety";

const MIN = 60_000;
const WALK_MAX_M = 8_000;
const BIKE_MAX_M = 25_000;
const STATION_CANDIDATES = 5;
const STATION_MAX_M = 70_000;
const STATION_PARK_MIN = 5;
const SHOWN_MAX = 6;
const ALT_GEOMETRY_BUDGET_MS = 2500;
const SAFETY_BUDGET_MS = 3500;
const TZ = "America/New_York";

/** A candidate before ranking, plus what is needed to describe it. */
interface Candidate {
  id: string;
  kind: JourneyMode;
  requires: JourneyMode[];
  title: string;
  leaveAt: number;
  arriveAt: number;
  bufferMin: number;
  legs: PlanLeg[];
  walkS: number;
  waitS: number;
  rides: number;
  costUsd: number | null;
  costNote: string;
  parking: JourneyOption["parking"];
  parkingNote: string | null;
  access: JourneyOption["access"];
  accessNote: string | null;
  scheduled: boolean;
  notes: string[];
  signature: string;
  /** Street geometry to score (walk, bike, drive), when the whole street part is routed. */
  street: { mode: "walk" | "bike" | "drive"; shape: LonLat[]; durationS: number } | null;
  materialize?: () => Promise<void>;
  safety?: SafetySummary | null;
}

/**
 * Optional window into a plan for callers that build on it (ArriveBy): every campus parking
 * place checked for the drive (eligible or not), every eligible option in ranked order (not only
 * the shown ones), and the context the times were planned in. Filled by planJourney.
 */
export interface JourneyCollector {
  parking: ParkingSeen[];
  ranked: JourneyOption[];
  campus: { id: CampusId; data: CampusData } | null;
  building: Building | null;
  entrance: Entrance | null;
  /** The drive (or the deadline) falls in a weekday rush hour. */
  peak: boolean;
  weather: WeatherState;
}

export function newCollector(): JourneyCollector {
  return { parking: [], ranked: [], campus: null, building: null, entrance: null, peak: false, weather: "unavailable" };
}

interface Env {
  req: JourneyRequest;
  collect: JourneyCollector | null;
  now: number;
  /** Departure instant for now/depart; null for arrive-by. */
  departAt: number | null;
  /** Deadline for arrive-by; null otherwise. */
  deadline: number | null;
  /** The instant the plan is about (departure or deadline). */
  anchor: number;
  origin: LonLat;
  dest: LonLat;
  destName: string;
  destEntrance: Entrance | null;
  campus: { id: CampusId; data: CampusData } | null;
  rainFactor: number;
  walkSpeed: number;
  pedOpts: Record<string, number | string>;
  weather: WeatherState;
  notes: string[];
}

function lineLength(shape: LonLat[]): number {
  let m = 0;
  for (let i = 1; i < shape.length; i++) m += straightM(shape[i - 1]!, shape[i]!);
  return m;
}

const usd = (v: number) => (v === 0 ? "$0" : Number.isInteger(v) ? `$${v}` : `$${v.toFixed(2)}`);

function peakAt(t: number): boolean {
  return isPeak(localWeekday(t, TZ), localMinutes(t, TZ));
}

/** Times for a trip of `seconds` (plus buffer): leave now/at, or arrive by. */
function place(env: Env, seconds: number, bufferMin: number): { leaveAt: number; arriveAt: number } {
  const total = seconds * 1000 + bufferMin * MIN;
  if (env.deadline !== null) return { leaveAt: env.deadline - total, arriveAt: env.deadline };
  return { leaveAt: env.departAt!, arriveAt: env.departAt! + total };
}

/** Which campus a destination belongs to: a campus building, or a point inside a campus's mapped bounds. */
async function campusFor(dest: JourneyPlace): Promise<{ id: CampusId; data: CampusData } | null> {
  if (dest.campus && dest.buildingId) {
    const data = await getCampus(dest.campus).catch(() => null);
    return data ? { id: dest.campus, data } : null;
  }
  for (const id of ["gt", "uga"] as CampusId[]) {
    const data = await getCampus(id).catch(() => null);
    if (!data) continue;
    const [[w, s], [e, n]] = data.bundle.bounds;
    if (dest.lon >= w && dest.lon <= e && dest.lat >= s && dest.lat <= n) return { id, data };
  }
  return null;
}

/** The commute planner's context for one campus/network, set up for this journey's timing. */
function ctxFor(env: Env, campus: CampusId, data: CampusData): Ctx {
  const leaveNow = env.deadline === null;
  const req: PlanRequest = {
    campus,
    origin: { lon: env.origin[0], lat: env.origin[1], label: env.req.origin.label },
    buildingId: env.req.destination.buildingId ?? "",
    deadline: env.deadline ?? env.departAt!,
    parkUntil: env.req.parkUntil ?? null,
    vehicle: { ...env.req.vehicle },
    fuelPrice: env.req.fuelPrice,
    walkSpeedMps: env.req.walkSpeedMps,
    modes: ["walk", "drive", "transit"],
    parkAt: null,
  };
  return {
    req,
    now: leaveNow ? env.departAt! : env.now,
    data,
    origin: env.origin,
    entrance: env.dest,
    entranceInfo: env.destEntrance,
    buildingName: env.destName,
    rainFactor: env.rainFactor,
    walkSpeed: env.walkSpeed,
    pedOpts: env.pedOpts,
    leaveNow,
    horizonMin: PLANNING_DEFAULTS.horizonMin,
  };
}

function walkingNote(env: Env): string | null {
  return env.req.prefs.accessible ? "Step-free route as mapped in OpenStreetMap; curb ramps and surfaces are not checked" : null;
}

// ---------------------------------------------------------------------------
// Walk and bike
// ---------------------------------------------------------------------------

async function streetOnly(env: Env, mode: "walk" | "bike"): Promise<Candidate[]> {
  const limit = mode === "walk" ? WALK_MAX_M : BIKE_MAX_M;
  if (straightM(env.origin, env.dest) > limit) return [];
  const opts = mode === "walk" ? env.pedOpts : undefined;
  let main;
  try {
    main = await routeWithSteps(mode, env.origin, env.dest, opts);
  } catch (err) {
    if (err instanceof RoutingError && err.kind === "unavailable") env.notes.push(`${mode === "walk" ? "Walking" : "Biking"} routes are unavailable right now`);
    return [];
  }
  const shapes = [{ shape: main.shape, lengthM: main.lengthM, durationS: main.durationS, steps: main.maneuvers }];
  // A second route that prefers sidewalks and paths (walking) or quieter streets (biking), when it is genuinely different.
  const prefer: Record<string, string | number> = mode === "walk" ? { ...env.pedOpts, walkway_factor: 0.6, sidewalk_factor: 0.6, alley_factor: 3, driveway_factor: 6 } : { use_roads: 0.1, bicycle_type: "Hybrid", avoid_bad_surfaces: 0.5 };
  // Only for trips where the variant is a practical choice (it costs two more routing calls with its safety check).
  const worthVariant = main.lengthM <= (mode === "walk" ? 4000 : 12_000);
  const alt = worthVariant
    ? await route({ mode, from: env.origin, to: env.dest, options: prefer })
        .then((r) => r[0] ?? null)
        .catch(() => null)
    : null;
  if (alt && overlap(main.shape, alt.shape) < 0.85) shapes.push({ shape: alt.shape, lengthM: alt.lengthM, durationS: alt.durationS, steps: [] });
  return shapes.map((s, i) => {
    const seconds = mode === "walk" ? s.durationS * env.rainFactor : s.durationS;
    const t = place(env, seconds, 0);
    const leg: PlanLeg =
      mode === "walk"
        ? { ...walkLeg(env.req.origin.label, env.destName, t.leaveAt, seconds, s.shape), meters: Math.round(s.lengthM) }
        : { kind: "walk", from: env.req.origin.label, to: env.destName, depart: t.leaveAt, arrive: t.arriveAt, minutes: Math.max(1, Math.round(seconds / 60)), meters: Math.round(s.lengthM), geometry: s.shape, note: "Bike" };
    if (s.steps.length) leg.steps = s.steps.filter((m) => m.instruction).map((m) => ({ instruction: m.instruction, meters: Math.round(m.lengthM) }));
    return {
      id: `${mode}${i ? `-alt${i}` : ""}`,
      kind: mode,
      requires: [mode],
      title: mode === "walk" ? (i ? "Walk · sidewalk route" : "Walk") : i ? "Bike · quieter streets" : "Bike",
      ...t,
      bufferMin: 0,
      legs: [leg],
      walkS: mode === "walk" ? seconds : 0,
      waitS: 0,
      rides: 0,
      costUsd: 0,
      costNote: "Free",
      parking: null,
      parkingNote: null,
      access: mode === "walk" && env.req.prefs.accessible ? "verified" : "not_applicable",
      accessNote: mode === "walk" ? walkingNote(env) : null,
      scheduled: false,
      notes: [],
      signature: `${mode}:${i}`,
      street: { mode, shape: s.shape, durationS: s.durationS },
    } satisfies Candidate;
  });
}

// ---------------------------------------------------------------------------
// Driving
// ---------------------------------------------------------------------------

function fuelCost(env: Env, meters: number): { usd: number | null; note: string } {
  const c = marginalTripCost({ drivenMiles: meters / 1609.344, mpg: env.req.vehicle.mpg, fuelPricePerGallon: env.req.fuelPrice, parkingUsd: 0, transitFaresUsd: 0 });
  return c.total === null ? { usd: null, note: "Gas not included (add mpg and gas price in Profile)" } : { usd: c.total, note: `Gas about ${usd(c.total)}` };
}

/** Driving straight to a destination that has no verified parking records. */
async function directDrive(env: Env): Promise<Candidate[]> {
  let routes;
  try {
    routes = await route({ mode: "drive", from: env.origin, to: env.dest, alternates: 1 });
  } catch (err) {
    if (err instanceof RoutingError && err.kind === "unavailable") env.notes.push("Driving routes are unavailable right now");
    return [];
  }
  return routes.slice(0, 2).map((r, i) => {
    const peak = peakAt(env.deadline ?? env.departAt!);
    const buf = driveBufferMin(r.durationS / 60, undefined, peak);
    const t = place(env, r.durationS, buf);
    const fuel = fuelCost(env, r.lengthM);
    const leg: PlanLeg = { kind: "drive", from: env.req.origin.label, to: env.destName, depart: t.leaveAt, arrive: t.arriveAt, minutes: Math.round(r.durationS / 60), meters: Math.round(r.lengthM), geometry: r.shape, note: `No live traffic · +${buf} min ${peak ? "rush-hour " : ""}buffer` };
    return {
      id: `drive${i ? `-alt${i}` : ""}`,
      kind: "drive" as const,
      requires: ["drive"] as JourneyMode[],
      title: i ? "Drive · alternate route" : "Drive",
      ...t,
      bufferMin: buf,
      legs: [leg],
      walkS: 0,
      waitS: 0,
      rides: 0,
      // Parking at an ordinary address is not known, so the full cost is not known.
      costUsd: null,
      costNote: `${fuel.note}; parking not included`,
      parking: null,
      parkingNote: "Parking at the destination isn't included",
      access: "not_applicable" as const,
      accessNote: null,
      scheduled: false,
      notes: [],
      signature: `drive:${i}`,
      street: { mode: "drive" as const, shape: r.shape, durationS: r.durationS },
    };
  });
}

/** Driving to a campus destination: only parking places whose verified rules allow (or charge for) the arrival. */
async function campusDrive(env: Env): Promise<Candidate[]> {
  const c = env.campus!;
  const ctx = ctxFor(env, c.id, c.data);
  const skipped = new Map<string, number>();
  let built: Built[];
  try {
    built = await driveCandidates(ctx, skipped, env.collect?.parking);
  } catch {
    env.notes.push("Driving routes are unavailable right now");
    return [];
  }
  for (const [reason, n] of skipped) env.notes.push(`${n} campus parking ${n === 1 ? "place" : "places"} skipped: ${reason.toLowerCase()}`);
  // A collecting caller (ArriveBy) needs every eligible place; the ordinary search keeps the four nearest.
  return built.slice(0, env.collect ? built.length : 4).map((b): Candidate => {
    const total = b.option.durationS;
    const t = place(env, total, b.option.bufferMin);
    shiftLegsBuffered(b.legs, t.leaveAt, b.option.bufferMin);
    const parkingCost = b.parking?.price ?? null;
    return {
      id: b.option.id,
      kind: "drive" as const,
      requires: ["drive"] as JourneyMode[],
      title: `Drive · park at ${b.title}`,
      ...t,
      bufferMin: b.option.bufferMin,
      legs: b.legs,
      walkS: b.walkMin * 60 * env.rainFactor,
      waitS: 0,
      rides: 0,
      costUsd: b.option.costUsd,
      costNote: b.option.costUsd !== null ? `Gas and parking ${usd(b.option.costUsd)}` : parkingCost !== null ? `Parking ${usd(parkingCost)}; gas not included` : b.parking?.status === "allowed" ? "Parking allowed now; price for your stay not checked" : "Pay to park; price depends on how long you stay",
      parking: b.parking,
      parkingNote: env.req.parkUntil ? "Checked for your whole stay." : "Checked for your arrival time only. Use Parking to check a full stay.",
      access: "not_applicable" as const,
      accessNote: walkingNote(env),
      scheduled: false,
      notes: [...b.notes.filter((n) => !/arrival only/.test(n)), ...(b.restriction ? [b.restriction] : [])],
      signature: b.option.signature,
      street: null,
      materialize: b.materialize,
    };
  });
}

/** Lay legs end to end from `start`; the drive leg absorbs the stated buffer. */
function shiftLegsBuffered(legs: PlanLeg[], start: number, bufferMin: number) {
  let t = start;
  for (const l of legs) {
    l.depart = t;
    t += (l.minutes + (l.kind === "drive" ? bufferMin : 0)) * MIN;
    l.arrive = t;
  }
}

// ---------------------------------------------------------------------------
// Transit (walk to a stop, or drive to a MARTA station with parking)
// ---------------------------------------------------------------------------

interface TransitRun {
  plan: TransitPlan;
  bufferMin: number;
}

function rideLegs(plan: TransitPlan): RideLeg[] {
  return plan.legs.filter((l): l is RideLeg => l.kind === "ride");
}

function searchTransit(env: Env, ctx: Ctx, day: TransitDay, access: AccessPoint[], egress: AccessPoint[], maxRides = 3): TransitRun | null {
  if (env.deadline !== null) return plannedTransit(ctx, day, access, egress, maxRides);
  const s = (env.departAt! - day.forward.ref) / 1000;
  const plan = earliestArrival(day.forward, access, egress, s, { maxRides, boardSlack: PLANNING_DEFAULTS.boardingSlackMin * 60, alightSlack: 0 });
  if (!plan) return null;
  return { plan, bufferMin: transitBufferMin(rideLegs(plan).map((r) => ({ headwaySec: r.headway }))) };
}

function accessOf(day: TransitDay, rides: RideLeg[]): { access: JourneyOption["access"]; note: string } {
  const net = day.net;
  const wc = net.stops.wheelchair;
  let unknown = false;
  for (const r of rides) {
    const pat = net.patterns[r.source]!;
    const stops = [r.fromStop, r.toStop].map((s) => wc?.[s] ?? 0);
    if (pat.access === 2 || stops.includes(2)) return { access: "unverified", note: `${badge(day, r.source).agency} marks part of this trip as not wheelchair accessible` };
    if (pat.access !== 1 || stops.includes(0)) unknown = true;
  }
  if (unknown) {
    const agencies = [...new Set(rides.map((r) => badge(day, r.source).agency))].join(" and ");
    return { access: "unverified", note: `${agencies} does not publish step-free access for every stop and trip used` };
  }
  return { access: "verified", note: `${[...new Set(rides.map((r) => badge(day, r.source).agency))].join(" and ")} lists every stop and trip used as wheelchair accessible` };
}

function fares(data: CampusData, day: TransitDay, rides: RideLeg[]): number | null {
  const table = (data.config.transit as { fares?: Record<string, { oneWay: number }> }).fares ?? {};
  let total = 0;
  for (const feed of new Set(rides.map((r) => day.net.routes[day.net.patterns[r.source]!.route]!.feed))) {
    const f = table[feed];
    if (!f) return null;
    total += f.oneWay;
  }
  return total;
}

function transitCandidate(env: Env, ctx: Ctx, day: TransitDay, run: TransitRun, suffix: string, data: CampusData): Candidate {
  const plan = run.plan;
  const rides = rideLegs(plan);
  const t = transitLegs(ctx, day, plan, env.req.origin.label, env.origin);
  const ref = day.forward.ref;
  const leaveAt = env.deadline !== null ? ref + plan.leave * 1000 : env.departAt!;
  const arriveAt = ref + plan.arrive * 1000 + run.bufferMin * MIN;
  const fare = fares(data, day, rides);
  const acc = accessOf(day, rides);
  const label = rides.map((r) => badge(day, r.source).short).join(" → ");
  return {
    id: `transit:${label}${suffix}`,
    kind: "transit",
    requires: ["transit"],
    title: label,
    leaveAt,
    arriveAt,
    bufferMin: run.bufferMin,
    legs: t.legs,
    walkS: t.walkS,
    waitS: t.waitS,
    rides: rides.length,
    costUsd: fare,
    costNote: fare === null ? "Fare not known" : fare === 0 ? "Fare-free" : `Fare ${usd(fare)}`,
    parking: null,
    parkingNote: null,
    access: acc.access,
    accessNote: acc.note,
    scheduled: true,
    notes: [run.bufferMin ? `Scheduled times, not live. Includes ${run.bufferMin} min for delays.` : "Scheduled times, not live.", ...(day.note ? [day.note] : [])],
    signature: `transit:${rides.map((r) => `${badge(day, r.source).short}@${r.fromStop}`).join(">")}`,
    street: null,
    materialize: t.fill,
  };
}

/** Drive to a MARTA rail station that has parking (verified record), then ride. */
async function stationParkRide(env: Env, ctx: Ctx, day: TransitDay, egress: AccessPoint[], data: CampusData): Promise<Candidate | null> {
  const rec = await martaStationParking();
  const net = day.net;
  if (!rec || !net.stations || !parkingRecordCurrent(rec, env.now)) return null;
  const parents = net.stops.parent ?? [];
  const stations = rec.stations
    .map((s) => {
      const i = net.stations!.id.indexOf(s.id);
      return i < 0 ? null : { rec: s, point: [net.stations!.lon[i]!, net.stations!.lat[i]!] as LonLat };
    })
    .filter((x): x is { rec: (typeof rec.stations)[number]; point: LonLat } => !!x)
    .map((x) => ({ ...x, m: straightM(env.origin, x.point) }))
    // Stations that are on the way: closer to the destination than the start is.
    .filter((x) => x.m <= STATION_MAX_M && straightM(x.point, env.dest) < straightM(env.origin, env.dest))
    .sort((a, b) => a.m - b.m)
    .slice(0, STATION_CANDIDATES);
  if (!stations.length) return null;
  const drive = await matrix("drive", [env.origin], stations.map((s) => s.point)).catch(() => null);
  if (!drive) return null;
  const peak = peakAt(env.deadline ?? env.departAt!);
  const access: AccessPoint[] = [];
  const meta = new Map<number, { station: (typeof stations)[number]; driveS: number; meters: number; buf: number }>();
  stations.forEach((s, k) => {
    const cell = drive[0]?.[k];
    if (!cell || cell.seconds === null || cell.meters === null) return;
    const buf = driveBufferMin(cell.seconds / 60, undefined, peak);
    parents.forEach((p, stop) => {
      if (p !== s.rec.id) return;
      access.push({ stop, seconds: Math.round(cell.seconds! + buf * 60 + STATION_PARK_MIN * 60) });
      meta.set(stop, { station: s, driveS: cell.seconds!, meters: cell.meters!, buf });
    });
  });
  if (!access.length) return null;
  const run = searchTransit(env, ctx, day, access, egress);
  if (!run) return null;
  const firstRide = rideLegs(run.plan)[0];
  const info = firstRide ? meta.get(run.plan.access.stop) ?? meta.get(firstRide.fromStop) : null;
  if (!info) return null;
  const st = info.station;
  // Re-express the access as: drive + park, then a one-minute walk to the platform.
  const accessS = run.plan.access.seconds;
  const walkToPlatform = 60;
  const shifted: TransitPlan = { ...run.plan, leave: run.plan.leave + (accessS - walkToPlatform), access: { ...run.plan.access, seconds: walkToPlatform } };
  const t = transitLegs(ctx, day, shifted, `${st.rec.name} station parking`, st.point);
  const ref = day.forward.ref;
  const leaveAt = env.deadline !== null ? ref + run.plan.leave * 1000 : env.departAt!;
  const driveLeg: PlanLeg = {
    kind: "drive",
    from: env.req.origin.label,
    to: `${st.rec.name} station`,
    depart: leaveAt,
    arrive: leaveAt + (info.driveS + info.buf * 60) * 1000,
    minutes: Math.round(info.driveS / 60),
    meters: Math.round(info.meters),
    geometry: [env.origin, st.point],
    note: `No live traffic · +${info.buf} min ${peak ? "rush-hour " : ""}buffer`,
  };
  const parkLeg: PlanLeg = { kind: "park", from: `${st.rec.name} station`, to: `${st.rec.name} station`, depart: driveLeg.arrive, arrive: driveLeg.arrive! + (STATION_PARK_MIN - 1) * MIN, minutes: STATION_PARK_MIN - 1, geometry: [] };
  const rides = rideLegs(run.plan);
  const fare = fares(data, day, rides);
  const fuel = fuelCost(env, info.meters);
  const acc = accessOf(day, rides);
  const label = rides.map((r) => badge(day, r.source).short).join(" → ");
  const parkingText = st.rec.longTermDaily ? `MARTA parking: free for the first ${rec.paidFreeHours} hours, then $${st.rec.longTermDaily}/day` : "MARTA free daily parking";
  const cost = fare === null || fuel.usd === null ? null : fare + fuel.usd;
  return {
    id: `pr:marta:${st.rec.id}`,
    kind: "park_ride",
    requires: ["drive", "park_ride", "transit"],
    title: `${st.rec.name} station + ${label}`,
    leaveAt,
    arriveAt: ref + run.plan.arrive * 1000 + run.bufferMin * MIN,
    bufferMin: run.bufferMin + info.buf,
    legs: [driveLeg, parkLeg, ...t.legs],
    walkS: t.walkS,
    waitS: t.waitS,
    rides: rides.length,
    costUsd: cost,
    costNote: [fare === null ? "Fare not known" : `Fare ${usd(fare)}`, fuel.usd === null ? "gas not included" : `gas about ${usd(fuel.usd)}`, "parking $0 for a same-day trip"].join(" · "),
    parking: null,
    parkingNote: `${parkingText}. Spaces are not guaranteed.${st.rec.note ? ` ${st.rec.note}` : ""}`,
    access: acc.access,
    accessNote: acc.note,
    scheduled: true,
    notes: [`Scheduled times, not live. Includes ${run.bufferMin} min for transit delays.`, ...(day.note ? [day.note] : [])],
    signature: `pr:${st.rec.id}:${label}`,
    street: null,
    materialize: async () => {
      try {
        const [r] = await route({ mode: "drive", from: env.origin, to: st.point });
        if (r) driveLeg.geometry = r.shape;
      } catch {
        driveLeg.note = `${driveLeg.note} · route sketch only`;
      }
      await t.fill();
    },
  };
}

async function transitCandidates(env: Env, coverage: TransitCoverage[]): Promise<Candidate[]> {
  const prefs = env.req.prefs;
  const wantTransit = prefs.modes.transit;
  const wantStation = prefs.modes.park_ride && prefs.modes.drive && prefs.modes.transit && env.req.vehicle.hasCar;
  const out: Candidate[] = [];
  for (const region of REGIONS) {
    const data = await getCampus(region.campus).catch(() => null);
    if (!data) continue;
    const day = await within(transitDay(region.campus, localDate(env.anchor, TZ), env.walkSpeed), 8000, null as TransitDay | null);
    if (!day) {
      coverage.push({ network: region.id, agencies: [], reaches: false, status: "unavailable", note: "Timetable could not be loaded" });
      continue;
    }
    const net = day.net;
    const access = reach(net, env.origin, ACCESS_RADIUS_M, env.walkSpeed);
    const egress = reach(net, env.dest, EGRESS_RADIUS_M, env.walkSpeed);
    const reaches = access.length > 0 && egress.length > 0;
    coverage.push({ network: region.id, agencies: agencyNames(net), reaches, status: egress.length || access.length ? day.status : "not_covered", note: day.note });
    if (!egress.length || day.status === "not_covered" || day.status === "no_service") continue;
    const ctx = ctxFor(env, region.campus, data);
    if (wantTransit && access.length) {
      const best = searchTransit(env, ctx, day, access, egress);
      if (best) {
        out.push(transitCandidate(env, ctx, day, best, "", data));
        // A genuine alternative with fewer rides, if one exists.
        const n = rideLegs(best.plan).length;
        if (n >= 2) {
          const fewer = searchTransit(env, ctx, day, access, egress, n - 1);
          if (fewer) out.push(transitCandidate(env, ctx, day, fewer, ":fewer", data));
        }
      }
    }
    // Drive to a station with parking: worth it when the start is not within walking reach, or far away.
    if (wantStation && region.id === "atlanta" && (!access.length || straightM(env.origin, env.dest) > 8000)) {
      const pr = await stationParkRide(env, ctx, day, egress, data).catch(() => null);
      if (pr) out.push(pr);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

/** Feed names in capitals become readable ("LINDBERGH CENTER STATION" → "Lindbergh Center Station"). */
function tidyLegs(legs: PlanLeg[]): PlanLeg[] {
  return legs.map((l) => ({
    ...l,
    from: tidyStopName(l.from),
    to: tidyStopName(l.to),
    headsign: l.headsign ? tidyStopName(l.headsign) : l.headsign,
    fromStop: l.fromStop ? { ...l.fromStop, name: tidyStopName(l.fromStop.name) } : l.fromStop,
    toStop: l.toStop ? { ...l.toStop, name: tidyStopName(l.toStop.name) } : l.toStop,
  }));
}

function legsDistance(legs: PlanLeg[]): number | null {
  let total = 0;
  for (const l of legs) {
    if (l.kind === "park" || l.kind === "wait") continue;
    if (l.meters !== undefined) total += l.meters;
    else if (l.kind === "ride" && l.geometry.length >= 2) total += lineLength(l.geometry);
    else if (l.kind === "walk" && l.geometry.length >= 2 && !/sketch/i.test(l.note ?? "")) total += lineLength(l.geometry);
    else return null;
  }
  return Math.round(total);
}

function toRank(c: Candidate): RankOption & { c: Candidate } {
  return {
    c,
    id: c.id,
    kind: c.kind,
    requires: c.requires,
    leaveAt: c.leaveAt,
    arriveAt: c.arriveAt,
    durationMin: (c.arriveAt - c.leaveAt) / MIN,
    distanceM: legsDistance(c.legs),
    walkMin: c.walkS / 60,
    waitMin: c.waitS / 60,
    transfers: Math.max(0, c.rides - 1),
    costUsd: c.costUsd,
    safety: c.safety ? { score: c.safety.score, mode: c.safety.mode } : null,
    access: c.access,
    signature: c.signature,
  };
}

export async function planJourney(req: JourneyRequest, now: number = Date.now(), collect: JourneyCollector | null = null): Promise<JourneyResponse> {
  const timing = req.timing;
  const departAt = timing.mode === "now" ? now : timing.mode === "depart" ? timing.at : null;
  const deadline = timing.mode === "arrive" ? timing.by : null;
  const anchor = departAt ?? deadline!;

  const campus = await campusFor(req.destination);
  const building = campus && req.destination.buildingId ? campus.data.buildings.get(req.destination.buildingId) ?? null : null;
  // Step-free first when asked for, otherwise a main entrance (see pickEntrance).
  const entrance = building ? pickEntrance(building.entrances, { accessible: req.prefs.accessible }) : null;
  const dest: LonLat = entrance ? [entrance.lon, entrance.lat] : building ? building.center : [req.destination.lon, req.destination.lat];
  const destName = building?.name ?? req.destination.label;

  const window: [number, number] = deadline !== null ? [deadline - 45 * MIN, deadline] : [departAt!, departAt! + 60 * MIN];
  const weather: WeatherView = await within(weatherFor(dest[1], dest[0], ...window), 4000, { state: "unavailable", avgMmPerHour: null, pop: null, updatedAt: null, alerts: [] });
  const rainFactor = rainFactorFor(weather.state);
  const pedOpts: Record<string, number | string> = { walking_speed: Math.round(req.walkSpeedMps * 3.6 * 10) / 10 };
  if (req.prefs.accessible) pedOpts.type = "wheelchair";

  const env: Env = {
    req,
    collect,
    now,
    departAt,
    deadline,
    anchor,
    origin: [req.origin.lon, req.origin.lat],
    dest,
    destName,
    destEntrance: entrance,
    campus,
    rainFactor,
    walkSpeed: req.walkSpeedMps / rainFactor,
    pedOpts,
    weather: weather.state,
    notes: [],
  };

  // Kinds of travel that are turned off are not computed at all (a hard constraint, enforced again below).
  const coverage: TransitCoverage[] = [];
  const m = req.prefs.modes;
  const hasCar = req.vehicle.hasCar;
  const [walks, bikes, drives, transit] = await Promise.all([
    m.walk ? streetOnly(env, "walk") : Promise.resolve([] as Candidate[]),
    m.bike ? streetOnly(env, "bike") : Promise.resolve([] as Candidate[]),
    m.drive && hasCar ? (campus ? campusDrive(env) : directDrive(env)) : Promise.resolve([] as Candidate[]),
    transitCandidates(env, coverage),
  ]);
  let all: Candidate[] = [...walks, ...bikes, ...drives, ...transit];

  // Arrive-by: an option is feasible only if you can still leave in time.
  const infeasible: Candidate[] = [];
  if (deadline !== null) {
    const ok = all.filter((c) => c.leaveAt >= now - 2 * MIN);
    infeasible.push(...all.filter((c) => c.leaveAt < now - 2 * MIN));
    all = ok;
  }

  // Two independent steps run side by side:
  // - safety indicators for street routes that pass the hard constraints (comparable within one mode only);
  // - road and footpath shapes for the options likely to be shown (the likely best match first, the rest
  //   within a short budget). Street-only options already have their full shapes, so safety cannot
  //   change which options need shapes, only their order and labels.
  const preliminary = rankOptions(applyConstraints(all.map(toRank), req.prefs).eligible, req.prefs, timing.mode);
  const passing = new Set(preliminary.ordered.map((r) => r.id));
  const likely = preliminary.ordered.slice(0, SHOWN_MAX);
  await Promise.all([
    within(
      Promise.all(
        all
          .filter((c) => c.street && passing.has(c.id))
          .map(async (c) => {
            c.safety = await streetSafety(c.street!.mode, c.street!.shape, c.street!.durationS);
          }),
      ),
      SAFETY_BUDGET_MS,
      [],
    ),
    (async () => {
      await likely[0]?.c.materialize?.().catch(() => undefined);
      await within(Promise.all(likely.slice(1).map((o) => o.c.materialize?.().catch(() => undefined))), ALT_GEOMETRY_BUDGET_MS, []);
    })(),
  ]);
  const scoredAny = all.some((c) => c.safety);

  const ranked = all.map(toRank);
  const { eligible, excluded } = applyConstraints(ranked, req.prefs);
  const ranking = rankOptions(eligible, req.prefs, timing.mode);
  const shown = ranking.ordered.slice(0, SHOWN_MAX);

  const toOption = (r: (typeof ranked)[number]): JourneyOption => {
    const c = r.c;
    const rain = c.walkS > 0 ? rainWalk([{ baselineMin: c.walkS / 60 / env.rainFactor, coveredFraction: null }], env.weather, 0).badgeMin : null;
    return {
      id: c.id,
      kind: c.kind,
      title: c.title,
      leaveAt: c.leaveAt,
      arriveAt: c.arriveAt,
      durationMin: Math.round(r.durationMin),
      bufferMin: c.bufferMin,
      distanceM: legsDistance(c.legs),
      walkMin: Math.round(r.walkMin),
      waitMin: Math.round(r.waitMin),
      transfers: r.transfers,
      rides: c.rides,
      costUsd: c.costUsd,
      costNote: c.costNote,
      legs: tidyLegs(c.legs),
      parking: c.parking,
      parkingNote: c.parkingNote,
      safety: c.safety ?? null,
      access: c.access,
      accessNote: c.accessNote,
      scheduled: c.scheduled,
      roles: ranking.roles.get(c.id) ?? [],
      explanation: ranking.explanations.get(c.id) ?? "",
      notes: [...c.notes, ...(rain ? [`Rain may add about ${rain} min of walking`] : [])],
      signature: c.signature,
    };
  };
  const options = shown.map(toOption);
  if (collect) {
    collect.ranked = ranking.ordered.map((r) => (shown.includes(r) ? options[shown.indexOf(r)]! : toOption(r)));
    collect.campus = campus;
    collect.building = building;
    collect.entrance = entrance;
    collect.peak = peakAt(anchor);
    collect.weather = weather.state;
  }
  const byId = new Map(ranked.map((r) => [r.id, r]));
  const excludedOut = excluded.map((e) => ({ title: byId.get(e.id)!.c.title, kind: byId.get(e.id)!.kind, reasons: e.reasons }));

  // Nothing arrives in time: show the earliest arrival if you leave now.
  let late: JourneyResponse["late"] = null;
  if (deadline !== null && !options.length && (infeasible.length || !all.length)) {
    const asap = await planJourney({ ...req, timing: { mode: "now" } }, now).catch(() => null);
    const first = asap?.options[0];
    if (first) late = { option: first, lateMin: Math.max(0, Math.ceil((first.arriveAt - deadline) / MIN)) };
  }

  const notes = [...env.notes];
  const severe = weather.alerts.filter((a) => a.severity === "Extreme" || a.severity === "Severe");
  if (severe.length) notes.unshift(`${severe[0]!.event} in effect`);
  if (weather.state === "unavailable") notes.push("Weather unavailable; walking times assume dry conditions");
  if (!hasCar) notes.push("Driving is off because you said you don't have a car (Profile)");
  if (infeasible.length && options.length) notes.push(`${infeasible.length} ${infeasible.length === 1 ? "option needs" : "options need"} you to have left already`);

  let transitSummary: string | null = null;
  if (req.prefs.modes.transit && !transit.length) {
    const near = coverage.filter((c) => c.reaches);
    if (!near.length) {
      transitSummary = "No public transit in CrossMetric's timetables serves both places. Timetables cover MARTA (Metro Atlanta), Athens-Clarke County Transit and UGA Campus Transit.";
    } else {
      const status = near.find((c) => c.status === "not_covered" || c.status === "no_service");
      transitSummary = status ? `${status.agencies.join(", ")}: ${status.note ?? "no service on this date"}.` : "No transit trip connects these places at this time.";
    }
  }

  // Ride-hail hand-off: a driving time, even for people without a car (prices come from the provider).
  const rs = drives.find((d) => d.street) ?? null;
  const rideRoute = rs ? null : await route({ mode: "drive", from: env.origin, to: env.dest }).then((r) => r[0] ?? null).catch(() => null);
  const rideshareDrive = rs ? { driveMin: Math.round(rs.street!.durationS / 60), distanceM: Math.round(lineLength(rs.street!.shape)) } : rideRoute ? { driveMin: Math.round(rideRoute.durationS / 60), distanceM: Math.round(rideRoute.lengthM) } : null;

  return {
    generatedAt: now,
    timing,
    timingLabel: timingLabel(timing, now, TZ),
    origin: req.origin,
    destination: { ...req.destination, label: destName },
    options,
    excluded: excludedOut,
    tradeoffs: ranking.tradeoffs,
    late,
    coverage: {
      transit: coverage,
      transitSummary,
      safety: scoredAny ? "CrossScore compares walking, biking or driving routes of the same kind using GDOT crash records and road data. It does not predict crashes or call a route safe. Transit rides are not scored." : null,
    },
    rideshare: rideshareDrive,
    notes,
    toleranceMin: ranking.toleranceMin,
  };
}

