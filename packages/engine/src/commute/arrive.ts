/**
 * Arrive-by planning: buffers, feasibility and choosing what to show.
 *
 * Every option carries the latest departure that satisfies
 *   leave + T_conservative <= deadline
 * where T_conservative is the baseline trip time plus stated buffers
 * ("Planning estimate"). Nothing here is a calibrated probability.
 */

export interface PlanningBuffers {
  /** Searching for a space and walking out of the facility. */
  parkingSearchMin: { deck: number; lot: number };
  /** Share of the baseline drive added when there is no live traffic. */
  driveUncertaintyShare: number;
  driveUncertaintyMinMin: number;
  /** Weekday rush hours (local minutes) get a larger share: free-flow times are most wrong then. */
  peakWindows: [number, number][];
  peakShare: number;
  peakMinMin: number;
  /** Reach the stop this long before the scheduled departure. */
  boardingSlackMin: number;
  /** Per ride on a timetabled (exact) trip. */
  scheduleUncertaintyMin: number;
  /** Per ride on a frequency-based trip: the headway, capped at this. */
  headwayUncertaintyCapMin: number;
  /** Planning horizon for transit departures before the deadline. */
  horizonMin: number;
}

export const PLANNING_DEFAULTS: PlanningBuffers = {
  parkingSearchMin: { deck: 5, lot: 7 },
  driveUncertaintyShare: 0.3,
  driveUncertaintyMinMin: 5,
  peakWindows: [
    [7 * 60, 10 * 60],
    [16 * 60, 19 * 60],
  ],
  peakShare: 0.6,
  peakMinMin: 8,
  boardingSlackMin: 1,
  scheduleUncertaintyMin: 3,
  headwayUncertaintyCapMin: 12,
  horizonMin: 240,
};

/**
 * Planning buffer for a drive with no live traffic. `peak` is true on a weekday rush hour
 * (see isPeak). These are provisional, stated assumptions, not a traffic model.
 */
export function driveBufferMin(baselineMin: number, b: PlanningBuffers = PLANNING_DEFAULTS, peak = false): number {
  return peak ? Math.max(b.peakMinMin, Math.round(baselineMin * b.peakShare)) : Math.max(b.driveUncertaintyMinMin, Math.round(baselineMin * b.driveUncertaintyShare));
}

/** Weekday rush hour at local `minute` on `weekday` (0 = Sunday). */
export function isPeak(weekday: number, minute: number, b: PlanningBuffers = PLANNING_DEFAULTS): boolean {
  return weekday >= 1 && weekday <= 5 && b.peakWindows.some(([s, e]) => minute >= s && minute < e);
}

export function transitBufferMin(rides: { headwaySec: number }[], b: PlanningBuffers = PLANNING_DEFAULTS): number {
  return rides.reduce((s, r) => s + (r.headwaySec > 0 ? Math.min(b.headwayUncertaintyCapMin, Math.round(r.headwaySec / 60)) : b.scheduleUncertaintyMin), 0);
}

export type OptionKind = "walk" | "drive" | "transit" | "park_ride";

export interface TripOption {
  id: string;
  kind: OptionKind;
  /** Latest departure (epoch ms) that meets the deadline with buffers; null when impossible within the horizon. */
  leaveBy: number | null;
  /** Expected arrival at the entrance when leaving at `leaveBy` (epoch ms). */
  arriveAt: number | null;
  /** Expected arrival if leaving right now (epoch ms); null when no service. */
  arriveIfNow: number | null;
  /** Baseline door-to-entrance time in seconds (no buffer). */
  durationS: number;
  bufferMin: number;
  /** Marginal cash cost, null when unknown. */
  costUsd: number | null;
  /** Exposed walking plus unsheltered waiting, minutes. */
  outdoorMin: number;
  rides: number;
  /** Groups options that are the same trip in practice (e.g. same parking place). */
  signature: string;
  /** Eligible for recommendation (legal, operating, accessible for this person). */
  eligible: boolean;
}

export interface Choice {
  recommended: TripOption | null;
  cheapest: TripOption | null;
  /** Least outdoor exposure (shown as "Less rain" when it is wet, "Less walking" otherwise). */
  lessExposure: TripOption | null;
  backup: TripOption | null;
  /** When nothing can arrive on time: the earliest attainable arrival. */
  late: { option: TripOption; arriveAt: number; lateMin: number } | null;
}

function total(o: TripOption) {
  return o.durationS / 60 + o.bufferMin;
}

function better(a: TripOption, b: TripOption): number {
  const la = a.leaveBy ?? -Infinity;
  const lb = b.leaveBy ?? -Infinity;
  if (Math.abs(la - lb) > 60_000) return lb - la;
  if (Math.abs(total(a) - total(b)) > 0.5) return total(a) - total(b);
  if (a.rides !== b.rides) return a.rides - b.rides;
  return (a.costUsd ?? Infinity) - (b.costUsd ?? Infinity);
}

/**
 * Pick the default and up to three distinct alternatives.
 * - recommended: latest feasible departure (ties: shorter, fewer rides, cheaper)
 * - cheapest: lowest known cost, shown only when cheaper than recommended
 * - lessExposure: least outdoor exposure within `maxDetourMin` extra travel
 * - backup: next-best feasible option that is meaningfully different: another mode when one
 *   is feasible (a second deck on the same drive is not much of a backup), else another signature
 */
export function chooseOptions(options: TripOption[], now: number, deadline: number, opts: { maxDetourMin: number } = { maxDetourMin: 5 }): Choice {
  const feasible = options.filter((o) => o.eligible && o.leaveBy !== null && o.leaveBy >= now).sort(better);
  const recommended = feasible[0] ?? null;
  if (!recommended) {
    const reachable = options.filter((o) => o.eligible && o.arriveIfNow !== null).sort((a, b) => a.arriveIfNow! - b.arriveIfNow!);
    const first = reachable[0];
    return {
      recommended: null,
      cheapest: null,
      lessExposure: null,
      backup: null,
      late: first ? { option: first, arriveAt: first.arriveIfNow!, lateMin: Math.max(0, Math.ceil((first.arriveIfNow! - deadline) / 60_000)) } : null,
    };
  }
  const others = feasible.filter((o) => o.signature !== recommended.signature);
  const cheapest =
    [...feasible].filter((o) => o.costUsd !== null).sort((a, b) => a.costUsd! - b.costUsd! || better(a, b))[0] ?? null;
  const showCheapest = cheapest && cheapest.signature !== recommended.signature && (recommended.costUsd === null || cheapest.costUsd! < recommended.costUsd - 0.009) ? cheapest : null;
  const candidate = [...feasible]
    .filter((o) => total(o) <= total(recommended) + opts.maxDetourMin)
    .sort((a, b) => a.outdoorMin - b.outdoorMin || better(a, b))[0];
  const lessExposure = candidate && candidate.signature !== recommended.signature && candidate.outdoorMin <= recommended.outdoorMin - 2 ? candidate : null;
  const shown = new Set([recommended.signature, showCheapest?.signature, lessExposure?.signature]);
  const shownKinds = new Set([recommended.kind, showCheapest?.kind, lessExposure?.kind]);
  const backup =
    others.find((o) => !shown.has(o.signature) && !shownKinds.has(o.kind)) ?? others.find((o) => o.kind !== recommended.kind) ?? others.find((o) => !shown.has(o.signature)) ?? others[0] ?? null;
  return { recommended, cheapest: showCheapest, lessExposure, backup, late: null };
}

/** "Leave in 8 min" / "Leave now" / "Leave at 7:55" for the dominant instruction. */
export function leaveInstruction(leaveBy: number, now: number): { kind: "now" | "soon" | "at"; minutes: number } {
  const min = Math.floor((leaveBy - now) / 60_000);
  if (min <= 0) return { kind: "now", minutes: 0 };
  if (min <= 90) return { kind: "soon", minutes: min };
  return { kind: "at", minutes: min };
}
