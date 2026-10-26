import "server-only";

import {
  chooseOptions,
  driveBufferMin,
  earliestArrival,
  isPeak,
  localMinutes,
  localWeekday,
  evaluateNow,
  evaluateStay,
  latestDeparture,
  localDate,
  marginalTripCost,
  nearbyStops,
  PLANNING_DEFAULTS,
  RAIN_DELTA,
  rainWalk,
  rideGeometry,
  transitBufferMin,
  type AccessPoint,
  type RideLeg,
  type ParkingPlaceRules,
  type StayEvaluation,
  type TransitPlan,
  type TripOption,
  type WeatherState,
} from "@crossmetric/engine/commute";
import type { Entrance, LonLat, ParkingPlaceInfo, PlanLeg, PlanOption, PlanRequest, PlanResponse, RouteBadge, WeatherView } from "@/lib/commute-types";
import { RoutingError, matrix, route, routeWithSteps } from "../valhalla";
import { getCampus, type CampusData } from "./data";
import { transitDay, type TransitDay } from "./transit";
import { weatherFor } from "./weather";

export class PlanInputError extends Error {}

const PARKING_RADIUS_M = 1600;
const MAX_PARKING_CANDIDATES = 8;
const ACCESS_RADIUS_M = 1200;
const EGRESS_RADIUS_M = 800;
const LOT_STOP_RADIUS_M = 450;
const MAX_WALK_M = 5000;
const ALT_GEOMETRY_BUDGET_MS = 1500;
const MIN = 60_000;

export function straightM(a: LonLat, b: LonLat): number {
  const k = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  return Math.hypot((a[0] - b[0]) * k, a[1] - b[1]) * 111_195;
}

export async function within<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const t = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([p.catch(() => fallback), t]);
  } finally {
    clearTimeout(timer);
  }
}

/** A candidate plus everything needed to describe it if it is shown. */
export interface Built {
  option: TripOption;
  title: string;
  legs: PlanLeg[];
  restriction: string | null;
  parking: PlanOption["parking"];
  costMissing: string[];
  notes: string[];
  /** Fill in road/footpath geometry and walking steps (only for options that are shown). */
  materialize?: () => Promise<void>;
  walkMin: number;
  waitMin: number;
}

export interface Ctx {
  req: PlanRequest;
  now: number;
  data: CampusData;
  origin: LonLat;
  entrance: LonLat;
  entranceInfo: Entrance | null;
  buildingName: string;
  /** Walking slows by this factor in rain (1 when dry or unknown). */
  rainFactor: number;
  walkSpeed: number;
  pedOpts: Record<string, number | string>;
  leaveNow: boolean;
  horizonMin: number;
}

export function walkLeg(from: string, to: string, depart: number | null, seconds: number, geometry: LonLat[]): PlanLeg {
  return { kind: "walk", from, to, depart, arrive: depart === null ? null : depart + seconds * 1000, minutes: Math.max(1, Math.round(seconds / 60)), geometry };
}

export async function fillWalk(leg: PlanLeg, a: LonLat, b: LonLat, ctx: Ctx) {
  try {
    const r = await routeWithSteps("walk", a, b, ctx.pedOpts);
    leg.geometry = r.shape;
    leg.meters = Math.round(r.lengthM);
    leg.steps = r.maneuvers.filter((m) => m.instruction).map((m) => ({ instruction: m.instruction, meters: Math.round(m.lengthM) }));
  } catch {
    leg.geometry = [a, b];
    leg.note = "Straight-line sketch; walking route unavailable";
  }
}

// ---------------------------------------------------------------------------
// Walk
// ---------------------------------------------------------------------------

async function walkCandidate(ctx: Ctx): Promise<Built | null> {
  if (straightM(ctx.origin, ctx.entrance) > MAX_WALK_M) return null;
  let r;
  try {
    r = await routeWithSteps("walk", ctx.origin, ctx.entrance, ctx.pedOpts);
  } catch {
    return null;
  }
  const seconds = r.durationS * ctx.rainFactor;
  const leaveBy = ctx.req.deadline - seconds * 1000;
  const leg = walkLeg(ctx.req.origin.label, ctx.buildingName, leaveBy, seconds, r.shape);
  leg.steps = r.maneuvers.filter((m) => m.instruction).map((m) => ({ instruction: m.instruction, meters: Math.round(m.lengthM) }));
  return {
    option: { id: "walk", kind: "walk", leaveBy, arriveAt: ctx.req.deadline, arriveIfNow: ctx.now + seconds * 1000, durationS: seconds, bufferMin: 0, costUsd: 0, outdoorMin: seconds / 60, rides: 0, signature: "walk", eligible: true },
    title: "Walk",
    legs: [leg],
    restriction: null,
    parking: null,
    costMissing: [],
    notes: [],
    walkMin: r.durationS / 60,
    waitMin: 0,
  };
}

// ---------------------------------------------------------------------------
// Drive and park
// ---------------------------------------------------------------------------

function peakAt(ctx: Ctx, t: number): boolean {
  const tz = ctx.data.config.timezone;
  return isPeak(localWeekday(t, tz), localMinutes(t, tz));
}

function evaluatePlace(ctx: Ctx, placeId: string, arrive: number): StayEvaluation | null {
  const rules = ctx.data.rules.get(placeId);
  if (!rules) return null;
  const vehicle = { permits: ctx.req.vehicle.permits, registered: ctx.req.vehicle.registered };
  const until = ctx.req.parkUntil;
  return until && until > arrive + MIN ? evaluateStay(rules, vehicle, arrive, until, ctx.now) : evaluateNow(rules, vehicle, arrive);
}

function parkingSummary(ev: StayEvaluation, placeId: string, stay: boolean): PlanOption["parking"] {
  return { placeId, status: ev.status, price: stay ? ev.price : null, reason: ev.reason, usableUntil: ev.usableUntil };
}

/** A campus parking place checked for a drive, eligible or not (for ArriveBy's parking list). */
export interface ParkingSeen {
  placeId: string;
  code: string;
  name: string;
  kind: "deck" | "lot";
  payment: string | null;
  driveS: number | null;
  driveM: number | null;
  bufferMin: number;
  searchMin: number;
  walkS: number | null;
  arriveAt: number | null;
  rules: ParkingPlaceRules | null;
  evaluation: StayEvaluation | null;
}

export async function driveCandidates(ctx: Ctx, skipped: Map<string, number>, seen?: ParkingSeen[]): Promise<Built[]> {
  if (!ctx.req.vehicle.hasCar) return [];
  const forced = ctx.req.parkAt ?? null;
  const places = ctx.data.bundle.parking
    .filter((p) => (forced ? p.id === forced : !p.parkAndRide))
    .map((p) => ({ p, m: straightM(p.center, ctx.entrance) }))
    .filter((x) => forced !== null || x.m <= PARKING_RADIUS_M)
    .sort((a, b) => a.m - b.m)
    .slice(0, MAX_PARKING_CANDIDATES)
    .map((x) => x.p);
  if (!places.length) return [];
  const [drive, walk] = await Promise.all([
    matrix("drive", [ctx.origin], places.map((p) => p.center)).catch(() => null),
    matrix("walk", places.map((p) => p.center), [ctx.entrance], ctx.pedOpts).catch(() => null),
  ]);
  if (!drive) {
    // Still report the places, as not routed, so a caller can say routing failed rather than "no parking".
    for (const p of places) seen?.push({ placeId: p.id, code: p.code, name: p.name, kind: p.kind, payment: p.payment, searchMin: p.kind === "deck" ? PLANNING_DEFAULTS.parkingSearchMin.deck : PLANNING_DEFAULTS.parkingSearchMin.lot, rules: ctx.data.rules.get(p.id) ?? null, driveS: null, driveM: null, bufferMin: 0, walkS: null, arriveAt: null, evaluation: null });
    throw new RoutingError("Drive times unavailable", "unavailable");
  }
  const out: Built[] = [];
  places.forEach((place, i) => {
    const d = drive[0]?.[i];
    const searchMin = place.kind === "deck" ? PLANNING_DEFAULTS.parkingSearchMin.deck : PLANNING_DEFAULTS.parkingSearchMin.lot;
    const base = { placeId: place.id, code: place.code, name: place.name, kind: place.kind, payment: place.payment, searchMin, rules: ctx.data.rules.get(place.id) ?? null };
    if (!d || d.seconds === null || d.meters === null) {
      seen?.push({ ...base, driveS: null, driveM: null, bufferMin: 0, walkS: null, arriveAt: null, evaluation: null });
      return;
    }
    const walkS = (walk?.[i]?.[0]?.seconds ?? (straightM(place.center, ctx.entrance) * 1.3) / ctx.walkSpeed) * ctx.rainFactor;
    const peak = peakAt(ctx, ctx.leaveNow ? ctx.now : ctx.req.deadline - (d.seconds + walkS) * 1000);
    const bufMin = driveBufferMin(d.seconds / 60, undefined, peak);
    const total = d.seconds + bufMin * 60 + searchMin * 60 + walkS;
    const anchor = ctx.leaveNow ? ctx.now + total * 1000 : ctx.req.deadline;
    const arriveLot = anchor - walkS * 1000 - searchMin * MIN;
    const ev = evaluatePlace(ctx, place.id, arriveLot);
    seen?.push({ ...base, driveS: d.seconds, driveM: d.meters, bufferMin: bufMin, walkS, arriveAt: arriveLot, evaluation: ev });
    if (!ev || (ev.status !== "allowed" && ev.status !== "requires_action")) {
      const reason = ev?.reason ?? "Rules unknown";
      skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
      return;
    }
    const stay = !!ctx.req.parkUntil && ctx.req.parkUntil > arriveLot + MIN;
    const cost = marginalTripCost({ drivenMiles: d.meters / 1609.344, mpg: ctx.req.vehicle.mpg, fuelPricePerGallon: ctx.req.fuelPrice, parkingUsd: stay ? ev.price : null, transitFaresUsd: 0 });
    const leaveBy = ctx.req.deadline - total * 1000;
    const departDrive = ctx.leaveNow ? ctx.now : leaveBy;
    const driveLeg: PlanLeg = { kind: "drive", from: ctx.req.origin.label, to: place.name, depart: departDrive, arrive: departDrive + (d.seconds + bufMin * 60) * 1000, minutes: Math.round(d.seconds / 60), meters: Math.round(d.meters), geometry: [ctx.origin, place.center], parkingPlaceId: place.id, note: `No live traffic · +${bufMin} min ${peak ? "rush-hour " : ""}buffer` };
    const parkLeg: PlanLeg = { kind: "park", from: place.name, to: place.name, depart: driveLeg.arrive, arrive: driveLeg.arrive! + searchMin * MIN, minutes: searchMin, geometry: [], parkingPlaceId: place.id };
    const wl = walkLeg(place.name, ctx.buildingName, parkLeg.arrive, walkS, [place.center, ctx.entrance]);
    // Without a park-until time only arrival is checked, so say when the rules next change.
    const restriction = !stay && ev.nextChange ? `${ev.nextChange.reason} from ${new Date(ev.nextChange.at).toLocaleTimeString("en-US", { timeZone: ctx.data.config.timezone, hour: "numeric", minute: "2-digit" })}` : null;
    out.push({
      option: {
        id: `drive:${place.id}`,
        kind: "drive",
        leaveBy,
        arriveAt: ctx.req.deadline,
        arriveIfNow: ctx.now + total * 1000,
        durationS: d.seconds + searchMin * 60 + walkS,
        bufferMin: bufMin,
        costUsd: cost.total,
        outdoorMin: walkS / 60,
        rides: 0,
        signature: `drive:${place.id}`,
        eligible: true,
      },
      title: place.name,
      legs: [driveLeg, parkLeg, wl],
      restriction,
      parking: parkingSummary(ev, place.id, stay),
      costMissing: cost.missing,
      notes: stay ? [] : ["Parking checked for arrival only; set when you will leave for a full-stay check"],
      walkMin: walkS / ctx.rainFactor / 60,
      waitMin: 0,
      materialize: async () => {
        try {
          const [r] = await route({ mode: "drive", from: ctx.origin, to: place.center });
          if (r) driveLeg.geometry = r.shape;
        } catch {
          driveLeg.note = `${driveLeg.note} · route sketch only`;
        }
        await fillWalk(wl, place.center, ctx.entrance, ctx);
      },
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Transit
// ---------------------------------------------------------------------------

export function badge(day: TransitDay, source: number): RouteBadge {
  const p = day.net.patterns[source]!;
  const r = day.net.routes[p.route]!;
  const agency = day.net.feeds.find((f) => f.id === r.feed)?.name ?? r.feed;
  return { short: r.short || r.long, long: r.long, color: r.color, text: r.text, agency };
}

export function stopInfo(day: TransitDay, i: number) {
  return { id: day.net.stops.id[i]!, name: day.net.stops.name[i]!, lon: day.net.stops.lon[i]!, lat: day.net.stops.lat[i]! };
}

export function stopPoint(day: TransitDay, i: number): LonLat {
  return [day.net.stops.lon[i]!, day.net.stops.lat[i]!];
}

function faresFor(ctx: Ctx, day: TransitDay, rides: RideLeg[]): number | null {
  const fares = (ctx.data.config.transit as { fares?: Record<string, { oneWay: number }> }).fares ?? {};
  const agencies = new Set(rides.map((r) => day.net.routes[day.net.patterns[r.source]!.route]!.feed));
  let total = 0;
  for (const a of agencies) {
    const f = fares[a];
    if (!f) return null;
    // Round trip: one fare each way (MARTA transfers within 3 hours are free).
    total += f.oneWay * 2;
  }
  return total;
}

/**
 * Legs for a forward transit itinerary: one walk to the boarding stop, then wait/ride
 * pairs with one walk between rides when needed, then one walk to the entrance.
 * Footpaths between bays of one station are folded into those walks.
 */
export function transitLegs(ctx: Ctx, day: TransitDay, plan: TransitPlan, startLabel: string, startPoint: LonLat): { legs: PlanLeg[]; walkS: number; waitS: number; fill: () => Promise<void> } {
  const ref = day.forward.ref;
  const legs: PlanLeg[] = [];
  let walkS = 0;
  let waitS = 0;
  let pendingWalk = plan.access.seconds;
  let walkFrom: { label: string; point: LonLat } = { label: startLabel, point: startPoint };
  let clock = plan.leave;
  const fills: (() => Promise<void>)[] = [];
  const flushWalk = (toStop: number | null) => {
    const to = toStop === null ? { label: ctx.buildingName, point: ctx.entrance } : { label: stopInfo(day, toStop).name, point: stopPoint(day, toStop) };
    if (pendingWalk >= 30 || toStop === null || legs.length === 0) {
      const leg = walkLeg(walkFrom.label, to.label, ref + clock * 1000, pendingWalk, [walkFrom.point, to.point]);
      legs.push(leg);
      const a = walkFrom.point;
      const b = to.point;
      // Very short walks (a stop across the street) keep a straight line.
      if (straightM(a, b) > 120) fills.push(() => fillWalk(leg, a, b, ctx));
    }
    clock += pendingWalk;
    walkS += pendingWalk;
    pendingWalk = 0;
  };
  for (const l of plan.legs) {
    if (l.kind === "walk") {
      pendingWalk += l.seconds;
      continue;
    }
    flushWalk(l.fromStop);
    const wait = l.depart - clock;
    if (wait >= 60) {
      legs.push({ kind: "wait", from: stopInfo(day, l.fromStop).name, to: stopInfo(day, l.fromStop).name, depart: ref + clock * 1000, arrive: ref + l.depart * 1000, minutes: Math.round(wait / 60), geometry: [] });
      waitS += wait;
    }
    legs.push({
      kind: "ride",
      from: stopInfo(day, l.fromStop).name,
      to: stopInfo(day, l.toStop).name,
      depart: ref + l.depart * 1000,
      arrive: ref + l.arrive * 1000,
      minutes: Math.max(1, Math.round((l.arrive - l.depart) / 60)),
      geometry: rideGeometry(day.net, l.source, l.boardIndex, l.alightIndex),
      route: badge(day, l.source),
      headsign: day.net.patterns[l.source]!.headsign,
      stops: l.alightIndex - l.boardIndex,
      headway: l.headway || undefined,
      fromStop: stopInfo(day, l.fromStop),
      toStop: stopInfo(day, l.toStop),
      note: l.headway ? `About every ${Math.round(l.headway / 60)} min` : "Scheduled",
    });
    clock = l.arrive;
    walkFrom = { label: stopInfo(day, l.toStop).name, point: stopPoint(day, l.toStop) };
  }
  pendingWalk += plan.egress.seconds;
  flushWalk(null);
  return { legs, walkS, waitS, fill: async () => void (await Promise.all(fills.map((f) => f()))) };
}

/** Latest departure with a buffer sized to the itinerary's own rides (re-planned until consistent). */
export function plannedTransit(ctx: Ctx, day: TransitDay, access: AccessPoint[], egress: AccessPoint[], maxRides = 3): { plan: TransitPlan; bufferMin: number } | null {
  const ref = day.forward.ref;
  const deadlineS = (ctx.req.deadline - ref) / 1000;
  let buffer = PLANNING_DEFAULTS.scheduleUncertaintyMin;
  let result: { plan: TransitPlan; bufferMin: number } | null = null;
  for (let i = 0; i < 3; i++) {
    const plan = latestDeparture(day.forward, day.reversed, access, egress, deadlineS - buffer * 60, { maxRides, boardSlack: PLANNING_DEFAULTS.boardingSlackMin * 60, alightSlack: 0 }, ctx.horizonMin * 60);
    if (!plan) return result;
    const need = transitBufferMin(plan.legs.filter((l): l is RideLeg => l.kind === "ride").map((r) => ({ headwaySec: r.headway })));
    result = { plan, bufferMin: Math.max(buffer, need) };
    if (need <= buffer) break;
    buffer = need;
  }
  return result;
}

function nowPlan(ctx: Ctx, day: TransitDay, access: AccessPoint[], egress: AccessPoint[]): TransitPlan | null {
  const nowS = (ctx.now - day.forward.ref) / 1000;
  if (nowS < -6 * 3600 || nowS > 30 * 3600) return null;
  return earliestArrival(day.forward, access, egress, nowS, { maxRides: 3, boardSlack: PLANNING_DEFAULTS.boardingSlackMin * 60, alightSlack: 0 });
}

async function transitCandidate(ctx: Ctx, day: TransitDay | null): Promise<Built | null> {
  if (!day || day.status === "not_covered") return null;
  const access = nearbyStops(day.net, ctx.origin[0], ctx.origin[1], ACCESS_RADIUS_M, { walkSpeedMps: ctx.walkSpeed, detourFactor: 1.3 });
  const egress = nearbyStops(day.net, ctx.entrance[0], ctx.entrance[1], EGRESS_RADIUS_M, { walkSpeedMps: ctx.walkSpeed, detourFactor: 1.3 });
  if (!access.length || !egress.length) return null;
  const ref = day.forward.ref;
  const now = nowPlan(ctx, day, access, egress);
  let planned: { plan: TransitPlan; bufferMin: number } | null;
  if (ctx.leaveNow) {
    if (!now) return null;
    const need = transitBufferMin(now.legs.filter((l): l is RideLeg => l.kind === "ride").map((r) => ({ headwaySec: r.headway })));
    planned = { plan: now, bufferMin: need };
  } else {
    planned = plannedTransit(ctx, day, access, egress);
  }
  const shown = planned?.plan ?? now;
  if (!shown) return null;
  const rides = shown.legs.filter((l): l is RideLeg => l.kind === "ride");
  const { legs, walkS, waitS, fill } = transitLegs(ctx, day, shown, ctx.req.origin.label, ctx.origin);
  const fare = faresFor(ctx, day, rides);
  const first = badge(day, rides[0]!.source);
  const leaveBy = planned && !ctx.leaveNow ? ref + planned.plan.leave * 1000 : null;
  const bufferMin = planned?.bufferMin ?? 0;
  const arriveIfNow = now ? ref + now.arrive * 1000 + bufferMin * MIN : null;
  return {
    option: {
      id: `transit:${first.short}`,
      kind: "transit",
      leaveBy: ctx.leaveNow ? ctx.now : leaveBy,
      arriveAt: ref + shown.arrive * 1000,
      arriveIfNow,
      durationS: shown.arrive - shown.leave,
      bufferMin,
      costUsd: fare,
      outdoorMin: (walkS + waitS) / 60,
      rides: rides.length,
      signature: `transit:${rides.map((r) => badge(day, r.source).short).join(">")}`,
      eligible: true,
    },
    title: rides.map((r) => badge(day, r.source).short).join(" → "),
    legs,
    restriction: day.note,
    parking: null,
    costMissing: fare === null ? ["fare"] : [],
    notes: [bufferMin ? `Plans to arrive ${bufferMin} min early for transit delays` : ""].filter(Boolean),
    walkMin: walkS / ctx.rainFactor / 60,
    waitMin: waitS / 60,
    materialize: fill,
  };
}

// ---------------------------------------------------------------------------
// Park & ride (drive to a remote lot, then ride)
// ---------------------------------------------------------------------------

export async function parkRideCandidates(ctx: Ctx, day: TransitDay | null, notes: string[]): Promise<Built[]> {
  if (!ctx.req.vehicle.hasCar || !day || day.status === "not_covered" || ctx.leaveNow) return [];
  const lots = ctx.data.bundle.parking.filter((p) => p.parkAndRide || /^(E23|E25|E26|S26)$/.test(p.code));
  if (!lots.length) return [];
  const egress = nearbyStops(day.net, ctx.entrance[0], ctx.entrance[1], EGRESS_RADIUS_M, { walkSpeedMps: ctx.walkSpeed, detourFactor: 1.3 });
  if (!egress.length) return [];
  const drive = await matrix("drive", [ctx.origin], lots.map((l) => l.center)).catch(() => null);
  if (!drive) return [];
  const out: Built[] = [];
  const ref = day.forward.ref;
  lots.forEach((lot: ParkingPlaceInfo, i) => {
    const d = drive[0]?.[i];
    if (!d || d.seconds === null || d.meters === null) return;
    const lotStops = nearbyStops(day.net, lot.center[0], lot.center[1], LOT_STOP_RADIUS_M, { walkSpeedMps: ctx.walkSpeed, detourFactor: 1.3 });
    if (!lotStops.length) return;
    const planned = plannedTransit(ctx, day, lotStops, egress);
    if (!planned) return;
    const searchMin = PLANNING_DEFAULTS.parkingSearchMin.lot;
    const lotArrive = ref + planned.plan.leave * 1000 - searchMin * MIN;
    const ev = evaluatePlace(ctx, lot.id, lotArrive);
    if (!ev || (ev.status !== "allowed" && ev.status !== "requires_action")) return;
    // A bus that runs somewhere on campus is not proof it reaches the car: check the ride back.
    if (ctx.req.parkUntil) {
      const back = earliestArrival(day.forward, egress, lotStops, (ctx.req.parkUntil - ref) / 1000, { maxRides: 2, boardSlack: 60, alightSlack: 0 });
      if (!back || back.arrive - (ctx.req.parkUntil - ref) / 1000 > 2 * 3600) {
        notes.push(`${lot.name} skipped: no bus back after you leave`);
        return;
      }
    }
    const peak = peakAt(ctx, lotArrive - d.seconds * 1000);
    const bufMin = driveBufferMin(d.seconds / 60, undefined, peak);
    const leaveBy = lotArrive - (d.seconds + bufMin * 60) * 1000;
    const rides = planned.plan.legs.filter((l): l is RideLeg => l.kind === "ride");
    const t = transitLegs(ctx, day, planned.plan, lot.name, lot.center);
    const driveLeg: PlanLeg = { kind: "drive", from: ctx.req.origin.label, to: lot.name, depart: leaveBy, arrive: lotArrive, minutes: Math.round(d.seconds / 60), geometry: [ctx.origin, lot.center], parkingPlaceId: lot.id, note: `No live traffic · +${bufMin} min ${peak ? "rush-hour " : ""}buffer` };
    const parkLeg: PlanLeg = { kind: "park", from: lot.name, to: lot.name, depart: lotArrive, arrive: lotArrive + searchMin * MIN, minutes: searchMin, geometry: [], parkingPlaceId: lot.id };
    const stay = !!ctx.req.parkUntil && ctx.req.parkUntil > lotArrive + MIN;
    const fare = faresFor(ctx, day, rides);
    const cost = marginalTripCost({ drivenMiles: d.meters / 1609.344, mpg: ctx.req.vehicle.mpg, fuelPricePerGallon: ctx.req.fuelPrice, parkingUsd: stay ? ev.price : null, transitFaresUsd: fare });
    const ridesLabel = rides.map((r) => badge(day, r.source).short).join(" → ");
    out.push({
      option: {
        id: `pr:${lot.id}`,
        kind: "park_ride",
        leaveBy,
        arriveAt: ref + planned.plan.arrive * 1000,
        arriveIfNow: null,
        durationS: (ctx.req.deadline - leaveBy) / 1000 - planned.bufferMin * 60 - bufMin * 60,
        bufferMin: planned.bufferMin + bufMin,
        costUsd: cost.total,
        outdoorMin: (t.walkS + t.waitS) / 60,
        rides: rides.length,
        signature: `pr:${lot.id}`,
        eligible: true,
      },
      title: `${lot.name} + ${ridesLabel}`,
      legs: [driveLeg, parkLeg, ...t.legs],
      restriction: day.note,
      parking: parkingSummary(ev, lot.id, stay),
      costMissing: cost.missing,
      notes: [],
      walkMin: t.walkS / ctx.rainFactor / 60,
      waitMin: t.waitS / 60,
      materialize: async () => {
        try {
          const [r] = await route({ mode: "drive", from: ctx.origin, to: lot.center });
          if (r) driveLeg.geometry = r.shape;
        } catch {
          /* sketch line stays */
        }
        await t.fill();
      },
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

export function rainFactorFor(state: WeatherState): number {
  if (state === "wet_unknown_intensity") return 1 + RAIN_DELTA.moderate;
  if (state === "light" || state === "moderate" || state === "heavy") return 1 + RAIN_DELTA[state];
  return 1;
}

function toPlanOption(b: Built, role: PlanOption["role"], weather: WeatherState): PlanOption {
  const rain = rainWalk([{ baselineMin: b.walkMin, coveredFraction: null }], weather, 0);
  return {
    id: b.option.id,
    kind: b.option.kind,
    title: b.title,
    leaveBy: b.option.leaveBy,
    arriveAt: b.option.arriveAt,
    arriveIfNow: b.option.arriveIfNow,
    minutes: Math.round(b.option.durationS / 60),
    bufferMin: b.option.bufferMin,
    costUsd: b.option.costUsd,
    costMissing: b.costMissing,
    outdoorMin: Math.round(b.option.outdoorMin),
    rides: b.option.rides,
    restriction: b.restriction,
    legs: b.legs,
    parking: b.parking,
    rainBadgeMin: rain.badgeMin,
    notes: b.notes,
    role,
  };
}

export async function planCommute(request: PlanRequest, now: number = Date.now(), departNow = false): Promise<PlanResponse> {
  let req = request;
  const data = await getCampus(req.campus);
  const building = req.toPoint ? null : data.buildings.get(req.buildingId);
  if (!building && !req.toPoint) throw new PlanInputError("Unknown building for this campus.");
  const ent = building?.entrances[0] ?? null;
  const entrance: LonLat = req.toPoint ? [req.toPoint.lon, req.toPoint.lat] : ent ? [ent.lon, ent.lat] : building!.center;
  const destName = req.toPoint ? req.toPoint.label : building!.name;
  const tz = data.config.timezone;
  if (req.toPoint) req = { ...req, modes: req.modes.filter((m) => m === "walk" || m === "transit") };
  if (req.lastService) {
    // The last departure today that still connects: plan against the end of the service day.
    const today = await transitDay(req.campus, localDate(now, tz), req.walkSpeedMps);
    req = { ...req, modes: ["transit"], deadline: today.forward.ref + 29 * 3600_000 };
  }

  const weather: WeatherView = await within(weatherFor(entrance[1], entrance[0], req.deadline - 45 * MIN, req.deadline), 4000, { state: "unavailable", avgMmPerHour: null, pop: null, updatedAt: null, alerts: [] });
  const rainFactor = rainFactorFor(weather.state);
  const walkSpeed = req.walkSpeedMps / rainFactor;
  const ctx: Ctx = {
    req,
    now,
    data,
    origin: [req.origin.lon, req.origin.lat],
    entrance,
    entranceInfo: ent,
    buildingName: destName,
    rainFactor,
    walkSpeed,
    pedOpts: { walking_speed: Math.round(req.walkSpeedMps * 3.6 * 10) / 10 },
    leaveNow: departNow,
    horizonMin: req.lastService ? 29 * 60 : PLANNING_DEFAULTS.horizonMin,
  };

  const day = await within(transitDay(req.campus, localDate(departNow ? now : req.deadline, tz), walkSpeed), 8000, null as TransitDay | null);
  const skipped = new Map<string, number>();
  const notes: string[] = [];
  const want = new Set(req.modes);
  const [walk, drives, transit, parkRides] = await Promise.all([
    want.has("walk") ? walkCandidate(ctx) : Promise.resolve(null),
    want.has("drive") ? driveCandidates(ctx, skipped).catch((err) => {
      if (err instanceof RoutingError) notes.push("Drive times are unavailable right now");
      return [] as Built[];
    }) : Promise.resolve([] as Built[]),
    want.has("transit") ? transitCandidate(ctx, day) : Promise.resolve(null),
    want.has("park_ride") ? parkRideCandidates(ctx, day, notes) : Promise.resolve([] as Built[]),
  ]);
  const built: Built[] = [walk, ...drives, transit, ...parkRides].filter((b): b is Built => b !== null);
  for (const [reason, n] of skipped) notes.push(`${n} nearby ${n === 1 ? "place" : "places"} skipped: ${reason.toLowerCase()}`);
  if (want.has("transit") && day?.status === "not_covered") notes.push("No published transit schedule for this date");

  // Leave-now mode ranks by earliest arrival: map arrival onto a "latest departure" scale.
  const horizon = now + 6 * 3600_000;
  const options = built.map((b) => (departNow ? { ...b.option, leaveBy: b.option.arriveIfNow === null ? null : now + (horizon - b.option.arriveIfNow) } : b.option));
  const choice = chooseOptions(options, now, departNow ? horizon : req.deadline);
  const byId = new Map(built.map((b) => [b.option.id, b]));
  const picked: { b: Built; role: PlanOption["role"] }[] = [];
  const add = (o: TripOption | null, role: PlanOption["role"]) => {
    if (!o || picked.length >= 3 || picked.some((p) => p.b.option.signature === o.signature)) return;
    picked.push({ b: byId.get(o.id)!, role });
  };
  add(choice.recommended, "recommended");
  add(choice.cheapest, "cheapest");
  add(choice.lessExposure, "lessRain");
  add(choice.backup, "backup");
  const lateBuilt = choice.late ? byId.get(choice.late.option.id) ?? null : null;
  // Road and footpath shapes: the recommended option first, alternatives within a short budget
  // (a late one keeps its sketch line; routing results are cached for the next refresh).
  await (picked[0]?.b.materialize?.() ?? lateBuilt?.materialize?.());
  await within(Promise.all(picked.slice(1).map((p) => p.b.materialize?.())), ALT_GEOMETRY_BUDGET_MS, []);

  const severe = weather.alerts.filter((a) => a.severity === "Extreme" || a.severity === "Severe");
  if (severe.length) notes.unshift(`${severe[0]!.event} in effect`);
  const shown = picked.map((p) => {
    const o = toPlanOption(p.b, p.role, weather.state);
    if (departNow) {
      o.leaveBy = now;
      o.arriveAt = p.b.option.arriveIfNow;
    }
    return o;
  });
  return {
    generatedAt: now,
    deadline: req.deadline,
    recommended: shown[0] ?? null,
    alternatives: shown.slice(1),
    late: choice.late && lateBuilt ? { option: toPlanOption(lateBuilt, null, weather.state), arriveAt: choice.late.arriveAt, lateMin: choice.late.lateMin } : null,
    status: {
      transit: day?.status ?? "not_covered",
      transitNote: day?.note ?? null,
      weather: weather.state,
      notes,
    },
    destination: { buildingId: building?.id ?? "", name: destName, entrance: ent, entranceVerified: !!ent },
  };
}
