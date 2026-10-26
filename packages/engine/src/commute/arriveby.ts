/**
 * ArriveBy: one arrival plan for "I need to be at this building by this time".
 *
 * The planner (routing, timetables, parking rules) produces candidate journeys that
 * already end at the deadline. This module turns them into a single decision:
 *
 *   leave-by = deadline − Σ high(component)
 *
 * where the components are disjoint parts of one journey (drive, finding a space,
 * walk to the entrance; or walk, wait, ride, walk, delay allowance). Each component
 * keeps a low–high range and where its number comes from, so the result can be
 * explained line by line and nothing is counted twice. It also chooses a parking
 * place from explicit rule evaluations, a backup that is genuinely viable, and a
 * comparison of the other ways to arrive in time.
 *
 * Pure functions, no I/O. Nothing here is a calibrated probability: confidence is
 * a plain-language summary of which inputs are estimates.
 */

import type { EligibilityStatus, ParkingPlaceRules, StayEvaluation } from "./parking";
import type { JourneyMode } from "./rank";

const MIN = 60_000;

// ---------------------------------------------------------------------------
// Provenance: where a number or a rule comes from
// ---------------------------------------------------------------------------

/**
 * How much a piece of information can be trusted, in the order the app explains it:
 * - official: an official source, hand-checked and within its review date (rules, timetables)
 * - live: a live feed with a confirmed source (none is connected for occupancy or traffic today)
 * - estimate: calculated by CrossMetric from routing and stated assumptions
 * - community: reported by other people and not verified
 * - user: what this person told the app (their permit)
 * - illustrative: example data for a demo, never used for a real plan
 * - unknown: not available
 */
export type DataStatus = "official" | "live" | "estimate" | "community" | "user" | "illustrative" | "unknown";

export interface Provenance {
  status: DataStatus;
  /** Plain words: "Routed walking time", "GT Parking visitor rates". */
  label: string;
  url?: string | null;
  /** Date the source was last checked (YYYY-MM-DD). */
  retrieved?: string | null;
  /** Date after which it must be re-checked before use (YYYY-MM-DD). */
  reviewBy?: string | null;
}

export interface SourceInfo {
  id: string;
  title: string;
  url: string;
  kind: "official" | "news" | "osm";
  retrieved: string;
  reviewBy: string;
}

export interface MinuteRange {
  low: number;
  high: number;
}

// ---------------------------------------------------------------------------
// Inputs (structural subsets of the planner's output, so the app passes them as they are)
// ---------------------------------------------------------------------------

export interface ArrivalLegInput {
  kind: "walk" | "drive" | "park" | "wait" | "ride";
  from: string;
  to: string;
  minutes: number;
  note?: string;
  route?: { short: string; agency: string };
  headway?: number;
  parkingPlaceId?: string;
}

export interface ArrivalOptionInput {
  id: string;
  kind: JourneyMode;
  title: string;
  /** Planned departure that meets the deadline with the stated buffers (epoch ms). */
  leaveAt: number;
  /** Planned arrival including buffers; at or before the deadline (epoch ms). */
  arriveAt: number;
  /** Minutes of planning buffer included (drive traffic buffer, transit delay allowance). */
  bufferMin: number;
  walkMin: number;
  waitMin: number;
  rides: number;
  costUsd: number | null;
  costNote: string;
  legs: ArrivalLegInput[];
  parking: { placeId: string; status: EligibilityStatus; price: number | null; reason: string; usableUntil: number | null } | null;
  scheduled: boolean;
  access: "verified" | "unverified" | "not_applicable";
  accessNote: string | null;
  notes: string[];
}

/** Space availability evidence for one parking place. */
export type OccupancyEvidence =
  | { kind: "none" }
  | { kind: "community"; state: "opening" | "full" | "conflicting"; reports: number; latestAt: number }
  | { kind: "live"; state: "available" | "limited" | "full"; spaces: number | null; source: string; at: number };

/** One parking place the planner checked for this arrival (eligible or not). */
export interface ParkingCheckInput {
  placeId: string;
  code: string;
  name: string;
  kind: "deck" | "lot";
  payment: string | null;
  /** Free-flow driving time to the place (s); null when it could not be routed. */
  driveS: number | null;
  /** Planning buffer on the drive (no live traffic), minutes. */
  bufferMin: number;
  /** Planned time to find a space and walk out of the facility (the high end), minutes. */
  searchMin: number;
  /** Walking time from the place to the entrance (s), as planned. */
  walkS: number | null;
  /** When the planner expects you at the place for this deadline (epoch ms). */
  arriveAt: number | null;
  /** The rule record (null: no verified record for this place). */
  rules: ParkingPlaceRules | null;
  /** Rule evaluation at `arriveAt` (or for the stay); null without a record. */
  evaluation: StayEvaluation | null;
  occupancy: OccupancyEvidence;
}

export type ArrivePreference = "best" | JourneyMode;

export interface ArrivalDestination {
  label: string;
  buildingId: string | null;
  entrance: EntranceChoice | null;
}

export interface ArrivalPlanInput {
  now: number;
  deadline: number;
  destination: ArrivalDestination;
  /** Options that arrive in time, best match first (the planner's order). */
  options: ArrivalOptionInput[];
  prefer: ArrivePreference;
  /** A parking place the person chose; used when it is eligible. */
  preferredPlaceId?: string | null;
  /** Campus parking checked for this arrival; null when the destination is not a campus building. */
  parking: ParkingCheckInput[] | null;
  /** Rule sources by id, for provenance. */
  sources: Record<string, SourceInfo>;
  vehicle: { hasCar: boolean; permits: string[] };
  /** Every place code CrossMetric has rules for on this campus (to spot a permit that matches none). */
  campusCodes: string[];
  campusName: string | null;
  accessible: boolean;
  /** The drive happens in a weekday rush hour (wider buffer). */
  peak: boolean;
  weatherAvailable: boolean;
  /** Driving time for a ride-hail drop-off at the entrance (hand-off only). */
  rideshare: { driveMin: number } | null;
  /** Nothing arrives in time: the earliest arrival leaving now. */
  late: { option: ArrivalOptionInput; lateMin: number } | null;
  /** Ways of travelling that produced no option, with why ("No timetabled transit…"). */
  unavailable: { kind: JourneyMode; reason: string }[];
  /** Transit day status when the options include transit. */
  transitStatus?: "scheduled" | "calendar_unconfirmed" | "modified" | "no_service" | "not_covered" | "unavailable" | null;
  /** The person asked for a full-stay parking check (leaving campus at this time). */
  parkUntil?: number | null;
  searchRange?: Record<"deck" | "lot", [number, number]>;
}

// ---------------------------------------------------------------------------
// Stated assumptions
// ---------------------------------------------------------------------------

/**
 * Finding a space and walking out of the facility, minutes. The high end is the
 * planner's buffer (PLANNING_DEFAULTS.parkingSearchMin); the low end is a quick
 * find. A planning assumption: no campus publishes occupancy CrossMetric can use.
 */
export const PARKING_SEARCH_RANGE: Record<"deck" | "lot", [number, number]> = { deck: [2, 5], lot: [3, 7] };

/** Extra margin suggested when confidence is low ("Check before you leave"). */
export const LOW_CONFIDENCE_EXTRA_MIN = 10;

/**
 * A place your permit covers (or a free one) is chosen over a pay place unless paying
 * lets you leave at least this much later.
 */
export const PERMIT_PREFERENCE_MIN = 10;

/** A rule record this close to its review date is flagged. */
export const REVIEW_SOON_DAYS = 7;

// ---------------------------------------------------------------------------
// Entrances
// ---------------------------------------------------------------------------

export interface EntranceInput {
  lon: number;
  lat: number;
  kind: "main" | "door";
  wheelchair: "yes" | "no" | "limited" | null;
  label: string | null;
}

export interface EntranceChoice {
  lon: number;
  lat: number;
  /** "Main entrance", "Entrance", or "Building centre" when no entrance is mapped. */
  label: string;
  kind: "main" | "door" | "centre";
  wheelchair: "yes" | "no" | "limited" | null;
  provenance: Provenance;
}

/**
 * The entrance to route to. Step-free first when asked for (mapped "yes", then
 * "limited", then unmapped; never "no" while another exists), otherwise a main
 * entrance before a side door. Ties keep the mapped order.
 */
export function pickEntrance<T extends EntranceInput>(entrances: T[], opts: { accessible: boolean }): T | null {
  if (!entrances.length) return null;
  const wc = (e: T) => (e.wheelchair === "yes" ? 0 : e.wheelchair === "limited" ? 1 : e.wheelchair === null ? 2 : 3);
  const main = (e: T) => (e.kind === "main" ? 0 : 1);
  const ranked = entrances.map((e, i) => ({ e, i })).sort((a, b) => (opts.accessible ? wc(a.e) - wc(b.e) : 0) || main(a.e) - main(b.e) || (opts.accessible ? 0 : wc(a.e) - wc(b.e)) || a.i - b.i);
  return ranked[0]!.e;
}

export function describeEntrance(e: EntranceInput | null, center: [number, number], osmDate: string | null): EntranceChoice {
  if (!e) {
    return { lon: center[0], lat: center[1], label: "Building centre", kind: "centre", wheelchair: null, provenance: { status: "unknown", label: "No entrance is mapped for this building; times are to its centre", retrieved: osmDate } };
  }
  return {
    lon: e.lon,
    lat: e.lat,
    label: e.label ? e.label : e.kind === "main" ? "Main entrance" : "Entrance",
    kind: e.kind,
    wheelchair: e.wheelchair,
    provenance: { status: "community", label: "Entrance mapped in OpenStreetMap", url: "https://www.openstreetmap.org/copyright", retrieved: osmDate },
  };
}

// ---------------------------------------------------------------------------
// Journey components
// ---------------------------------------------------------------------------

export type ComponentKind = "drive" | "park_search" | "walk_to_stop" | "walk" | "wait" | "ride" | "bike" | "delay_allowance";

export interface ArrivalComponent {
  kind: ComponentKind;
  label: string;
  minutes: MinuteRange;
  detail: string | null;
  provenance: Provenance;
}

const rideName = (l: ArrivalLegInput) => (l.route ? `${l.route.short}` : "Ride");

/**
 * The parts of one option, in order, each with a range. The ranges' high ends add up
 * to the planned door-to-entrance time (legs plus buffer): the drive buffer widens the
 * drive, the search for a space is its own part, and a transit delay allowance is
 * one separate part — so no minute is counted twice.
 */
export function arrivalComponents(o: ArrivalOptionInput, opts: { peak?: boolean; searchRange?: Record<"deck" | "lot", [number, number]>; parkingKind?: "deck" | "lot" | null } = {}): ArrivalComponent[] {
  const range = opts.searchRange ?? PARKING_SEARCH_RANGE;
  const out: ArrivalComponent[] = [];
  const rideLegs = o.legs.filter((l) => l.kind === "ride");
  const firstRide = o.legs.findIndex((l) => l.kind === "ride");
  const driveBuffer = o.kind === "drive" ? o.bufferMin : 0;
  // Park & ride: the buffer covers both the drive and the ride; it stays one allowance.
  const allowance = o.kind === "drive" ? 0 : o.bufferMin;
  o.legs.forEach((l, i) => {
    const m = Math.max(0, l.minutes);
    if (l.kind === "drive") {
      const buf = o.kind === "drive" ? driveBuffer : 0;
      out.push({
        kind: "drive",
        label: "Drive",
        minutes: { low: m, high: m + buf },
        detail: buf ? `${m} min with clear roads + ${buf} min ${opts.peak ? "rush-hour " : ""}buffer (no live traffic)` : `to ${l.to}`,
        provenance: { status: "estimate", label: "Routed on OpenStreetMap roads; no live traffic" },
      });
    } else if (l.kind === "park") {
      // Campus places have a stated low–high range; other parking (a MARTA station) keeps its single estimate.
      const kind = opts.parkingKind ?? null;
      const low = kind ? Math.min(range[kind][0], m) : m;
      out.push({ kind: "park_search", label: "Find a space", minutes: { low, high: m }, detail: l.to, provenance: { status: "estimate", label: "CrossMetric planning assumption; space availability isn't published" } });
    } else if (l.kind === "walk") {
      const toStop = firstRide >= 0 && i < firstRide;
      const between = firstRide >= 0 && i > firstRide && o.legs.slice(i + 1).some((x) => x.kind === "ride");
      const isBike = l.note === "Bike";
      out.push({
        kind: isBike ? "bike" : toStop ? "walk_to_stop" : "walk",
        label: isBike ? "Bike" : toStop ? "Walk to the stop" : between ? "Walk to the next stop" : rideLegs.length || o.kind === "drive" || o.kind === "park_ride" ? "Walk to the entrance" : "Walk",
        minutes: { low: m, high: m },
        detail: isBike ? null : `to ${l.to}`,
        provenance: { status: "estimate", label: l.note && /sketch/i.test(l.note) ? "Straight-line estimate; walking route unavailable" : isBike ? "Routed bike time" : "Routed walking time at your walking speed" },
      });
    } else if (l.kind === "wait") {
      out.push({ kind: "wait", label: "Wait", minutes: { low: m, high: m }, detail: `at ${l.from}`, provenance: { status: "official", label: "Published timetable; not live" } });
    } else if (l.kind === "ride") {
      out.push({
        kind: "ride",
        label: rideName(l),
        minutes: { low: m, high: m },
        detail: `${l.from} → ${l.to}${l.headway ? ` · about every ${Math.round(l.headway / 60)} min` : ""}`,
        provenance: { status: "official", label: `${l.route?.agency ?? "Transit"} timetable; not live` },
      });
    }
  });
  if (allowance > 0) {
    out.push({ kind: "delay_allowance", label: "Allow for delays", minutes: { low: 0, high: allowance }, detail: rideLegs.length ? "Buses and trains can run late; the plan arrives early by this much" : "Planning buffer", provenance: { status: "estimate", label: "CrossMetric planning buffer" } });
  }
  return out;
}

export function sumRange(cs: { minutes: MinuteRange }[]): MinuteRange {
  return cs.reduce((s, c) => ({ low: s.low + c.minutes.low, high: s.high + c.minutes.high }), { low: 0, high: 0 });
}

export interface LeaveWindow {
  /** Leave by this time to arrive by the deadline with every buffer used (epoch ms, floored to the minute). */
  leaveBy: number;
  /** Latest departure if every part comes in at its low end; null when a timetable fixes the departure. */
  latestIfSmooth: number | null;
  fixedBy: "timetable" | null;
  /** Arrival when leaving at `leaveBy`: [everything quick, every buffer used]. */
  arrive: [number, number];
  /** Minutes between the planned arrival (with buffers) and the deadline. */
  spareMin: number;
  total: MinuteRange;
}

const floorMin = (t: number) => Math.floor(t / MIN) * MIN;

export function leaveWindow(o: ArrivalOptionInput, components: ArrivalComponent[], deadline: number): LeaveWindow {
  const slack = components.reduce((s, c) => s + (c.minutes.high - c.minutes.low), 0);
  const leaveBy = floorMin(o.leaveAt);
  const timetable = o.legs.some((l) => l.kind === "ride");
  const totalHigh = Math.max(1, Math.round((o.arriveAt - o.leaveAt) / MIN));
  const total = { low: Math.max(1, totalHigh - slack), high: totalHigh };
  return {
    leaveBy,
    latestIfSmooth: timetable || slack <= 0 ? null : floorMin(o.leaveAt + slack * MIN),
    fixedBy: timetable ? "timetable" : null,
    arrive: [o.arriveAt - slack * MIN, o.arriveAt],
    spareMin: Math.max(0, Math.floor((deadline - o.arriveAt) / MIN)),
    total,
  };
}

// ---------------------------------------------------------------------------
// Parking
// ---------------------------------------------------------------------------

/**
 * recommended / backup: eligible and chosen; eligible: allowed or pay-to-park at arrival;
 * uncertain: no record, rules unclear, unpublished or past review (never treated as allowed);
 * restricted: the rules do not allow you then; closed: an event or closure; full: occupancy
 * evidence says full; unavailable: could not be routed.
 */
export type ParkingVerdict = "recommended" | "backup" | "eligible" | "uncertain" | "restricted" | "closed" | "full" | "unavailable";

/** Why you may park: your permit, a visitor/pay rule, a free period, or not at all / unknown. */
export type ParkingAccess = "your_permit" | "pay" | "free" | "none" | "unknown";

export interface ParkingAssessment {
  placeId: string;
  code: string;
  name: string;
  kind: "deck" | "lot";
  verdict: ParkingVerdict;
  access: ParkingAccess;
  reason: string;
  /** Start-to-entrance minutes through this place: low (quick) to high (every buffer). */
  total: MinuteRange | null;
  walkMin: number | null;
  /** Leave by this time to arrive in time through this place (epoch ms). */
  leaveBy: number | null;
  price: number | null;
  payment: string | null;
  usableUntil: number | null;
  nextChange: { at: number; status: EligibilityStatus; reason: string } | null;
  rules: Provenance;
  occupancy: { label: string; full: boolean; provenance: Provenance };
}

function ruleProvenance(p: ParkingCheckInput, sources: Record<string, SourceInfo>, access: ParkingAccess): Provenance {
  if (!p.rules || !p.evaluation) return { status: "unknown", label: "No verified rule record for this place" };
  if (access === "your_permit") return { status: "user", label: "Your permit, as you entered it. Signs and your permit terms take precedence." };
  const ids = p.evaluation.sourceIds.filter((s) => sources[s]);
  const first = p.evaluation.segments[0];
  const used = first?.ruleId ? p.rules.rules.find((r) => r.id === first.ruleId)?.sourceId ?? null : null;
  const src = (used && sources[used]) || (ids[0] ? sources[ids[0]] : undefined);
  if (!src) return { status: "unknown", label: "Rule source not recorded" };
  return { status: src.kind === "official" ? "official" : "community", label: src.title, url: src.url, retrieved: src.retrieved, reviewBy: p.rules.reviewBy };
}

function accessOf(p: ParkingCheckInput): ParkingAccess {
  const ev = p.evaluation;
  if (!ev || !p.rules) return "unknown";
  if (ev.status === "unknown") return "unknown";
  if (ev.status === "prohibited") return "none";
  const rule = p.rules.rules.find((r) => r.id === ev.segments[0]?.ruleId);
  if (ev.status === "requires_action") return "pay";
  return rule?.audience === "permit" ? "your_permit" : "free";
}

function occupancyOf(o: OccupancyEvidence, now: number): ParkingAssessment["occupancy"] {
  if (o.kind === "live") {
    const word = o.state === "full" ? "Full" : o.state === "limited" ? "Few spaces" : "Spaces available";
    return { label: `${word}${o.spaces !== null ? ` · ${o.spaces} spaces` : ""}`, full: o.state === "full", provenance: { status: "live", label: o.source } };
  }
  if (o.kind === "community") {
    const ago = Math.max(0, Math.round((now - o.latestAt) / MIN));
    const word = o.state === "full" ? "Reported full" : o.state === "opening" ? "Opening reported" : "Mixed reports";
    return { label: `${word} · ${ago} min ago · not verified`, full: o.state === "full", provenance: { status: "community", label: `${o.reports} ${o.reports === 1 ? "report" : "reports"} from other people` } };
  }
  return { label: "Availability not verified", full: false, provenance: { status: "unknown", label: "No occupancy data is published for this place" } };
}

/** Classify every checked place for this arrival. Unknown is never treated as permission. */
export function assessParking(places: ParkingCheckInput[], ctx: { now: number; deadline: number; sources: Record<string, SourceInfo>; searchRange?: Record<"deck" | "lot", [number, number]> }): ParkingAssessment[] {
  const range = ctx.searchRange ?? PARKING_SEARCH_RANGE;
  return places.map((p) => {
    const access = accessOf(p);
    const occupancy = occupancyOf(p.occupancy, ctx.now);
    const ev = p.evaluation;
    let verdict: ParkingVerdict;
    let reason: string;
    if (p.driveS === null || p.walkS === null) {
      verdict = "unavailable";
      reason = "Couldn't calculate the drive or walk for this place";
    } else if (!ev || !p.rules) {
      verdict = "uncertain";
      reason = "No verified rules for this place";
    } else if (ev.status === "prohibited") {
      const seg = ev.segments.find((s) => s.status === "prohibited");
      const closed = !!seg?.ruleId && p.rules.overrides.some((o) => o.id === seg.ruleId && o.effect === "closed");
      verdict = closed ? "closed" : "restricted";
      reason = ev.reason;
    } else if (ev.status === "unknown") {
      verdict = "uncertain";
      reason = ev.reason;
    } else if (occupancy.full) {
      verdict = "full";
      reason = occupancy.label;
    } else {
      verdict = "eligible";
      reason = ev.reason;
    }
    const routed = p.driveS !== null && p.walkS !== null;
    const walkMin = p.walkS !== null ? Math.max(1, Math.round(p.walkS / 60)) : null;
    const driveMin = p.driveS !== null ? p.driveS / 60 : null;
    const lowSearch = Math.min(range[p.kind][0], p.searchMin);
    const total = routed ? { low: Math.round(driveMin! + lowSearch + p.walkS! / 60), high: Math.round(driveMin! + p.bufferMin + p.searchMin + p.walkS! / 60) } : null;
    const leaveBy = routed ? floorMin(ctx.deadline - (p.driveS! + p.bufferMin * 60 + p.searchMin * 60 + p.walkS!) * 1000) : null;
    return {
      placeId: p.placeId,
      code: p.code,
      name: p.name,
      kind: p.kind,
      verdict,
      access,
      reason,
      total,
      walkMin,
      leaveBy,
      price: ev?.price ?? null,
      payment: p.payment,
      usableUntil: ev?.usableUntil ?? null,
      nextChange: ev?.nextChange ?? null,
      rules: ruleProvenance(p, ctx.sources, access),
      occupancy,
    };
  });
}

const ACCESS_RANK: Record<ParkingAccess, number> = { your_permit: 0, free: 1, pay: 2, unknown: 3, none: 4 };

function betterPlace(a: ParkingAssessment, b: ParkingAssessment): number {
  const la = a.leaveBy ?? -Infinity;
  const lb = b.leaveBy ?? -Infinity;
  if (ACCESS_RANK[a.access] !== ACCESS_RANK[b.access] && Math.abs(la - lb) < PERMIT_PREFERENCE_MIN * MIN) return ACCESS_RANK[a.access] - ACCESS_RANK[b.access];
  if (Math.abs(la - lb) >= 2 * MIN) return lb - la;
  return (a.walkMin ?? 99) - (b.walkMin ?? 99) || ACCESS_RANK[a.access] - ACCESS_RANK[b.access];
}

export interface ParkingTradeoff {
  /** Extra minutes of walking compared with the first choice (negative: less). */
  walkDeltaMin: number;
  /** How many minutes earlier you would need to leave (negative: later). */
  leaveEarlierMin: number;
  text: string;
}

export function parkingTradeoff(primary: ParkingAssessment, alt: ParkingAssessment): ParkingTradeoff {
  const walkDeltaMin = (alt.walkMin ?? 0) - (primary.walkMin ?? 0);
  const leaveEarlierMin = primary.leaveBy !== null && alt.leaveBy !== null ? Math.round((primary.leaveBy - alt.leaveBy) / MIN) : 0;
  const parts: string[] = [];
  parts.push(alt.access === "your_permit" ? "Eligible for your permit" : alt.access === "pay" ? "Pay to park" : alt.access === "free" ? "No charge at this time" : "Rules unclear");
  if (walkDeltaMin >= 1) parts.push(`adds about ${walkDeltaMin} min of walking`);
  else if (walkDeltaMin <= -1) parts.push(`about ${-walkDeltaMin} min less walking`);
  else parts.push("about the same walk");
  if (leaveEarlierMin >= 1) parts.push(`leave ${leaveEarlierMin} min earlier`);
  else if (leaveEarlierMin <= -1) parts.push(`you could leave ${-leaveEarlierMin} min later`);
  const occ = alt.occupancy.provenance.status === "unknown" ? "Availability has not been verified." : `${alt.occupancy.label}.`;
  return { walkDeltaMin, leaveEarlierMin, text: `${parts.join(", ").replace(/^./, (c) => c.toUpperCase())}. ${occ}` };
}

export interface ParkingPlan {
  primary: ParkingAssessment | null;
  backup: (ParkingAssessment & { tradeoff: ParkingTradeoff }) | null;
  /** Every place checked, chosen ones first, then eligible, then the rest with their reasons. */
  places: ParkingAssessment[];
  /** The nearest place on foot, when it could not be used: what happened to it. */
  firstChoiceIssue: { name: string; verdict: ParkingVerdict; reason: string } | null;
  /** Why nothing is recommended, when nothing is. */
  emptyReason: string | null;
  permits: { matched: string[]; unmatched: string[] };
  stayChecked: boolean;
}

/** Permits that match no place CrossMetric has rules for get no privileges (and are reported). */
export function permitMatch(permits: string[], codes: string[]): { matched: string[]; unmatched: string[] } {
  const set = new Set(codes.map((c) => c.toUpperCase()));
  const clean = [...new Set(permits.map((p) => p.trim().toUpperCase()).filter(Boolean))];
  return { matched: clean.filter((p) => set.has(p)), unmatched: clean.filter((p) => !set.has(p)) };
}

const VERDICT_ORDER: Record<ParkingVerdict, number> = { recommended: 0, backup: 1, eligible: 2, full: 3, uncertain: 4, closed: 5, restricted: 6, unavailable: 7 };

/**
 * Choose where to park: your permit's place (or a free one) unless a pay place lets you leave
 * at least PERMIT_PREFERENCE_MIN later; otherwise the place that lets you leave latest (ties:
 * shorter walk). The person's chosen place wins when it is eligible.
 * The backup is the best other eligible place. Uncertain, restricted, closed, full and
 * unroutable places are listed with their reasons and never chosen.
 */
export function chooseParking(assessed: ParkingAssessment[], opts: { preferredId?: string | null; permits: { matched: string[]; unmatched: string[] }; stayChecked?: boolean }): ParkingPlan {
  const eligible = assessed.filter((a) => a.verdict === "eligible").sort(betterPlace);
  const preferred = opts.preferredId ? eligible.find((a) => a.placeId === opts.preferredId) : undefined;
  const primary = preferred ?? eligible[0] ?? null;
  const other = primary ? eligible.find((a) => a.placeId !== primary.placeId) ?? null : null;
  const places = assessed
    .map((a) => (primary && a.placeId === primary.placeId ? { ...a, verdict: "recommended" as const } : other && a.placeId === other.placeId ? { ...a, verdict: "backup" as const } : a))
    .sort((a, b) => VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict] || betterPlace(a, b));
  const nearest = [...assessed].filter((a) => a.walkMin !== null).sort((a, b) => a.walkMin! - b.walkMin!)[0];
  const firstChoiceIssue = nearest && primary && nearest.placeId !== primary.placeId && nearest.verdict !== "eligible" ? { name: nearest.name, verdict: nearest.verdict, reason: nearest.reason } : null;
  let emptyReason: string | null = null;
  if (!primary) {
    if (!assessed.length) emptyReason = "No campus parking with verified rules is within walking distance of this building.";
    else if (assessed.every((a) => a.verdict === "unavailable")) emptyReason = "Driving times couldn't be calculated right now.";
    else if (assessed.some((a) => a.verdict === "uncertain") && !assessed.some((a) => a.verdict === "restricted" || a.verdict === "closed" || a.verdict === "full")) emptyReason = "The parking rules for this time aren't published or need re-checking, so no place is recommended.";
    else emptyReason = "None of the nearby places allows your vehicle at this arrival time.";
  }
  return {
    primary: primary ? { ...primary, verdict: "recommended" } : null,
    backup: primary && other ? { ...other, verdict: "backup", tradeoff: parkingTradeoff(primary, other) } : null,
    places,
    firstChoiceIssue,
    emptyReason,
    permits: opts.permits,
    stayChecked: !!opts.stayChecked,
  };
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

export interface PlanChoice {
  optionId: string;
  kind: JourneyMode;
  title: string;
  components: ArrivalComponent[];
  window: LeaveWindow;
  costUsd: number | null;
  costNote: string;
}

export type BackupPlan =
  | { kind: "place"; placeId: string; name: string; optionId: string | null; leaveBy: number | null; text: string }
  | { kind: "option"; optionId: string; mode: JourneyMode; title: string; leaveBy: number; text: string }
  | { kind: "rideshare"; driveMin: number; text: string }
  | { kind: "none"; text: string };

export interface ComparisonRow {
  optionId: string;
  kind: JourneyMode;
  title: string;
  leaveBy: number;
  total: MinuteRange;
  walkMin: number;
  costUsd: number | null;
  costNote: string;
  /** Compared with the plan shown: "Leave 12 min earlier · no parking needed". */
  versus: string;
  chosen: boolean;
}

export interface Confidence {
  level: "steady" | "variable" | "uncertain";
  headline: string;
  reasons: string[];
  /** Extra minutes to leave earlier than the plan when confidence is low (0 otherwise). */
  extraMin: number;
}

export interface AccessAssessment {
  requested: boolean;
  /** CrossMetric never confirms a complete step-free route from map data alone. */
  status: "not_requested" | "unconfirmed";
  summary: string;
  mapped: string[];
  gaps: string[];
}

export interface ArrivalPlan {
  deadline: number;
  now: number;
  destination: ArrivalDestination;
  status: "ok" | "late" | "no_options";
  primary: PlanChoice | null;
  parking: ParkingPlan | null;
  backup: BackupPlan;
  comparison: ComparisonRow[];
  confidence: Confidence;
  access: AccessAssessment;
  late: { optionId: string; arriveAt: number; lateMin: number } | null;
  /** Things the person should know about how the plan was chosen. */
  notices: string[];
}

const MODE_WORDS: Record<JourneyMode, string> = { walk: "Walking", bike: "Biking", transit: "Transit", drive: "Driving", park_ride: "Park & ride" };

function choiceFor(o: ArrivalOptionInput, input: ArrivalPlanInput, parkingKind: "deck" | "lot" | null): PlanChoice {
  const components = arrivalComponents(o, { peak: input.peak, searchRange: input.searchRange, parkingKind });
  return { optionId: o.id, kind: o.kind, title: o.title, components, window: leaveWindow(o, components, input.deadline), costUsd: o.costUsd, costNote: o.costNote };
}

function versus(row: ArrivalOptionInput, chosen: ArrivalOptionInput): string {
  const parts: string[] = [];
  const d = Math.round((chosen.leaveAt - row.leaveAt) / MIN);
  if (d >= 2) parts.push(`Leave ${d} min earlier`);
  else if (d <= -2) parts.push(`Leave ${-d} min later`);
  else parts.push("Leave about the same time");
  if (chosen.kind === "drive" && row.kind !== "drive" && row.kind !== "park_ride") parts.push("no parking needed");
  const w = row.walkMin - chosen.walkMin;
  if (w >= 3) parts.push(`${w} min more walking`);
  else if (w <= -3) parts.push(`${-w} min less walking`);
  if (row.scheduled) parts.push("timetabled");
  return parts.join(" · ");
}

function pickOption(input: ArrivalPlanInput): { option: ArrivalOptionInput | null; notice: string | null } {
  const opts = input.options;
  if (!opts.length) return { option: null, notice: null };
  if (input.prefer === "best") return { option: opts[0]!, notice: null };
  const match = opts.find((o) => o.kind === input.prefer) ?? (input.prefer === "transit" ? opts.find((o) => o.kind === "park_ride") : undefined);
  if (match) return { option: match, notice: null };
  const why = input.unavailable.find((u) => u.kind === input.prefer)?.reason;
  return { option: opts[0]!, notice: `${MODE_WORDS[input.prefer]} can't get you there by the time you chose${why ? ` (${why.replace(/\.$/, "")})` : ""}. Showing the best other way.` };
}

function daysUntil(date: string, now: number): number {
  const [y, m, d] = date.split("-").map(Number);
  return Math.floor((Date.UTC(y!, m! - 1, d!) - now) / 86_400_000);
}

function confidenceFor(input: ArrivalPlanInput, choice: PlanChoice | null, o: ArrivalOptionInput | null, parking: ParkingPlan | null, backup: BackupPlan): Confidence {
  const reasons: string[] = [];
  let severe = 0;
  let moderate = 0;
  if (!choice || !o) return { level: "uncertain", headline: "No plan arrives in time", reasons: [], extraMin: 0 };
  const hasDrive = choice.components.some((c) => c.kind === "drive");
  const hasRide = choice.components.some((c) => c.kind === "ride");
  if (hasDrive) {
    reasons.push("Drive times have no live traffic; a planning buffer is included.");
    if (input.peak) {
      reasons.push("Rush hour: driving time can vary a lot.");
      moderate++;
    }
  }
  if (o.kind === "drive" && parking?.primary) {
    const p = parking.primary;
    if (p.occupancy.provenance.status === "unknown") {
      reasons.push("Space availability isn't published, so a space isn't guaranteed.");
      moderate++;
    }
    if (p.rules.reviewBy && daysUntil(p.rules.reviewBy, input.now) <= REVIEW_SOON_DAYS) {
      reasons.push(`The parking rule record is due for re-checking by ${p.rules.reviewBy}.`);
      moderate++;
    }
    if (!parking.stayChecked) reasons.push("Parking is checked for your arrival time; add when you leave campus to check the whole stay.");
  }
  if (hasRide) {
    reasons.push("Transit times are from the published timetable, not live vehicle positions.");
    if (input.transitStatus === "calendar_unconfirmed" || input.transitStatus === "modified") {
      reasons.push("The transit service calendar for this date isn't confirmed.");
      severe++;
    }
    if (o.legs.some((l) => l.kind === "ride" && (l.headway ?? 0) > 0)) {
      reasons.push("Some service runs at a frequency rather than set times.");
      moderate++;
    }
  }
  if (!input.weatherAvailable) reasons.push("Weather wasn't available; walking times assume dry conditions.");
  if (input.destination.entrance?.kind === "centre") {
    reasons.push("No entrance is mapped, so the last walk is to the building's centre.");
    moderate++;
  }
  if (backup.kind === "none") {
    reasons.push("There's no verified backup if this plan fails.");
    moderate++;
  }
  if (choice.window.total.high - choice.window.total.low >= 15) moderate++;
  const level: Confidence["level"] = severe ? "uncertain" : moderate ? "variable" : "steady";
  const headline = level === "steady" ? "Good to plan on" : level === "variable" ? "Allow for the range shown" : "Check before you leave";
  return { level, headline, reasons, extraMin: level === "uncertain" ? LOW_CONFIDENCE_EXTRA_MIN : 0 };
}

function accessFor(input: ArrivalPlanInput, o: ArrivalOptionInput | null): AccessAssessment {
  if (!input.accessible) return { requested: false, status: "not_requested", summary: "", mapped: [], gaps: [] };
  const mapped: string[] = [];
  const gaps: string[] = [];
  const e = input.destination.entrance;
  if (!e || e.kind === "centre") gaps.push("No entrance is mapped for this building, so step-free access to it can't be checked.");
  else if (e.wheelchair === "yes") mapped.push("This entrance is mapped as wheelchair accessible in OpenStreetMap (community data, not confirmed by the campus).");
  else if (e.wheelchair === "limited") mapped.push("This entrance is mapped as having limited wheelchair access in OpenStreetMap.");
  else if (e.wheelchair === "no") gaps.push("This entrance is mapped as not wheelchair accessible, and no accessible entrance is mapped.");
  else gaps.push("Whether this entrance is step-free isn't mapped.");
  if (o && o.legs.some((l) => l.kind === "walk")) gaps.push("Walking uses OpenStreetMap's wheelchair profile; curb ramps, slopes, surfaces and elevators are not checked.");
  if (o && o.kind === "drive") gaps.push("Accessible parking spaces aren't located by CrossMetric; use the campus accessible-parking map.");
  if (o?.accessNote && o.legs.some((l) => l.kind === "ride")) (o.access === "verified" ? mapped : gaps).push(o.accessNote);
  return { requested: true, status: "unconfirmed", summary: "CrossMetric can't confirm a complete step-free route.", mapped, gaps };
}

/** One arrival plan from the planner's options and the parking it checked. */
export function buildArrivalPlan(input: ArrivalPlanInput): ArrivalPlan {
  const notices: string[] = [];
  const permits = permitMatch(input.vehicle.permits, input.campusCodes);
  if (permits.unmatched.length && input.parking) {
    notices.push(`${permits.unmatched.join(", ")} doesn't match a parking place CrossMetric has rules for${input.campusName ? ` at ${input.campusName}` : ""}, so it is treated as no permit.`);
  }
  const assessed = input.parking ? assessParking(input.parking, { now: input.now, deadline: input.deadline, sources: input.sources, searchRange: input.searchRange }) : null;

  // Drive options by place, so the chosen place's drive can be shown.
  const driveByPlace = new Map<string, ArrivalOptionInput>();
  for (const o of input.options) if (o.kind === "drive" && o.parking && !driveByPlace.has(o.parking.placeId)) driveByPlace.set(o.parking.placeId, o);

  let { option, notice } = pickOption(input);
  if (notice) notices.push(notice);
  let parking: ParkingPlan | null = null;
  if (assessed) {
    // Only places with a routed drive option can be the plan; the rest stay listed.
    const usable = assessed.map((a) => (a.verdict === "eligible" && !driveByPlace.has(a.placeId) ? { ...a, verdict: "unavailable" as const, reason: "No drive option was calculated to this place" } : a));
    parking = chooseParking(usable, { preferredId: input.preferredPlaceId ?? null, permits, stayChecked: !!input.parkUntil });
    if (option?.kind === "drive") {
      const viaPrimary = parking.primary ? driveByPlace.get(parking.primary.placeId) : undefined;
      if (viaPrimary) option = viaPrimary;
      else {
        // The drive's place can't be used (full, closed, …): fall back to another way.
        const other = input.options.find((o) => o.kind !== "drive");
        if (other) {
          notices.push(`Driving isn't recommended: ${parking.emptyReason ?? "no usable parking"} Showing ${MODE_WORDS[other.kind].toLowerCase()} instead.`);
          option = other;
        }
      }
    }
    if (input.preferredPlaceId && parking.primary && parking.primary.placeId !== input.preferredPlaceId) {
      const chosen = assessed.find((a) => a.placeId === input.preferredPlaceId);
      if (chosen) notices.push(`${chosen.name} can't be used for this arrival (${chosen.reason.replace(/\.$/, "").toLowerCase()}).`);
    }
  }

  const kindOf = (placeId: string | undefined) => (placeId ? (assessed?.find((a) => a.placeId === placeId)?.kind ?? null) : null);
  const primary = option ? choiceFor(option, input, kindOf(option.parking?.placeId)) : null;

  // Backup: another eligible place for a drive, else another way to arrive in time, else a ride-hail drop-off.
  let backup: BackupPlan;
  const otherKind = option ? input.options.find((o) => o.kind !== option!.kind && !(option!.kind === "drive" && o.kind === "drive")) : undefined;
  if (option?.kind === "drive" && parking?.backup) {
    const b = parking.backup;
    backup = { kind: "place", placeId: b.placeId, name: b.name, optionId: driveByPlace.get(b.placeId)?.id ?? null, leaveBy: b.leaveBy, text: b.tradeoff.text };
  } else if (option && otherKind) {
    const lead = option.kind === "drive" ? "No other eligible parking nearby. " : "";
    backup = { kind: "option", optionId: otherKind.id, mode: otherKind.kind, title: otherKind.title, leaveBy: floorMin(otherKind.leaveAt), text: `${lead}${versus(otherKind, option)}.` };
  } else if (option && input.options.find((o) => o.id !== option!.id && o.kind === option!.kind)) {
    const alt = input.options.find((o) => o.id !== option!.id && o.kind === option!.kind)!;
    backup = { kind: "option", optionId: alt.id, mode: alt.kind, title: alt.title, leaveBy: floorMin(alt.leaveAt), text: `${versus(alt, option)}.` };
  } else if (input.rideshare) {
    backup = { kind: "rideshare", driveMin: input.rideshare.driveMin, text: `A ride-hail drop-off at the entrance is about a ${input.rideshare.driveMin} min drive plus pickup time; prices and pickup are in the provider's app.` };
  } else {
    backup = { kind: "none", text: "No verified alternative arrives in time. Leave earlier, or check the official campus parking and transit pages." };
  }

  // Comparison: the best option of each other kind (one row each), plus the chosen one.
  const seen = new Set<JourneyMode>();
  const comparison: ComparisonRow[] = [];
  const usableDrive = option?.kind === "drive" ? option : parking ? (parking.primary ? driveByPlace.get(parking.primary.placeId) ?? null : null) : undefined;
  for (const o of input.options) {
    if (seen.has(o.kind)) continue;
    seen.add(o.kind);
    // A campus drive is compared through the place that can actually be used (none: no row).
    const row = o.kind === "drive" && usableDrive !== undefined ? usableDrive : o;
    if (!row) continue;
    const comps = arrivalComponents(row, { peak: input.peak, searchRange: input.searchRange, parkingKind: kindOf(row.parking?.placeId) });
    const w = leaveWindow(row, comps, input.deadline);
    comparison.push({ optionId: row.id, kind: row.kind, title: row.title, leaveBy: w.leaveBy, total: w.total, walkMin: row.walkMin, costUsd: row.costUsd, costNote: row.costNote, versus: option && row.id !== option.id ? versus(row, option) : "This plan", chosen: !!option && row.id === option.id });
  }

  const late = !option && input.late ? { optionId: input.late.option.id, arriveAt: input.late.option.arriveAt, lateMin: input.late.lateMin } : null;
  const status: ArrivalPlan["status"] = option ? "ok" : late ? "late" : "no_options";
  return {
    deadline: input.deadline,
    now: input.now,
    destination: input.destination,
    status,
    primary,
    parking,
    backup,
    comparison,
    confidence: confidenceFor(input, primary, option, parking, backup),
    access: accessFor(input, option),
    late,
    notices,
  };
}
