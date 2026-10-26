/**
 * Rain-adjusted walking. All coefficients are provisional engineering
 * assumptions awaiting campus calibration, not results of a walking study.
 */

export type RainCategory = "dry" | "light" | "moderate" | "heavy";
export type WeatherState = RainCategory | "wet_unknown_intensity" | "unavailable";

/** Fractional walking slowdown on fully exposed paths. */
export const RAIN_DELTA: Record<RainCategory, number> = { dry: 0, light: 0.05, moderate: 0.12, heavy: 0.2 };

/** Operational buckets for a trustworthy mm/h intensity: 0, (0, 2.5), [2.5, 7.5), >= 7.5. */
export function categorizeIntensity(mmPerHour: number): RainCategory {
  if (!(mmPerHour > 0)) return "dry";
  if (mmPerHour < 2.5) return "light";
  if (mmPerHour < 7.5) return "moderate";
  return "heavy";
}

export interface WalkEdge {
  baselineMin: number;
  /** Verified covered share 0-1; null when unknown (planned as exposed). */
  coveredFraction: number | null;
}

/** Walking minutes on one edge under a rain category. */
export function wetWalkMinutes(edge: WalkEdge, cat: RainCategory): number {
  const u = 1 - (edge.coveredFraction ?? 0);
  return edge.baselineMin * (1 + u * RAIN_DELTA[cat]);
}

export interface RainEstimate {
  state: WeatherState;
  baselineMin: number;
  /** Adjusted walking minutes; a [low, high] range when intensity is unknown; null when unavailable. */
  adjustedMin: number | null;
  range: [number, number] | null;
  /** Outdoor exposure minutes (exposed walking plus unsheltered waiting). */
  exposureMin: number;
  /** Rounded extra minutes for display, or null when there is no estimated effect. */
  badgeMin: number | null;
}

export function rainWalk(edges: WalkEdge[], state: WeatherState, unshelteredWaitMin = 0): RainEstimate {
  const baseline = edges.reduce((s, e) => s + e.baselineMin, 0);
  const exposedShare = (e: WalkEdge) => 1 - (e.coveredFraction ?? 0);
  const exposure = (cat: RainCategory) => edges.reduce((s, e) => s + exposedShare(e) * wetWalkMinutes(e, cat), 0) + unshelteredWaitMin;
  if (state === "unavailable") return { state, baselineMin: baseline, adjustedMin: null, range: null, exposureMin: exposure("dry"), badgeMin: null };
  if (state === "wet_unknown_intensity") {
    const lo = edges.reduce((s, e) => s + wetWalkMinutes(e, "light"), 0);
    const hi = edges.reduce((s, e) => s + wetWalkMinutes(e, "moderate"), 0);
    const extra = Math.round(hi - baseline);
    return { state, baselineMin: baseline, adjustedMin: hi, range: [lo, hi], exposureMin: exposure("moderate"), badgeMin: extra >= 1 ? extra : null };
  }
  const adjusted = edges.reduce((s, e) => s + wetWalkMinutes(e, state), 0);
  const extra = Math.round(adjusted - baseline);
  return { state, baselineMin: baseline, adjustedMin: adjusted, range: null, exposureMin: exposure(state), badgeMin: state !== "dry" && extra >= 1 ? extra : null };
}

// ---------------------------------------------------------------------------
// National Weather Service gridpoint data
// ---------------------------------------------------------------------------

export interface GridValue {
  start: number;
  end: number;
  value: number | null;
}

/** Parse an NWS ISO interval ("2026-10-13T12:00:00+00:00/PT3H") into epoch ms bounds. */
export function parseNwsInterval(validTime: string): { start: number; end: number } | null {
  const [startIso, dur] = validTime.split("/");
  const start = Date.parse(startIso ?? "");
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(dur ?? "");
  if (!Number.isFinite(start) || !m) return null;
  const ms = ((Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0)) * 60 + Number(m[3] ?? 0)) * 60_000;
  return ms > 0 ? { start, end: start + ms } : null;
}

export function parseGridSeries(series: { values?: { validTime: string; value: number | null }[] } | undefined): GridValue[] {
  const out: GridValue[] = [];
  for (const v of series?.values ?? []) {
    const iv = parseNwsInterval(v.validTime);
    if (iv) out.push({ ...iv, value: v.value });
  }
  return out;
}

/**
 * Rain state for a walk window from NWS quantitative precipitation (mm per interval).
 * The interval total divided by its length is an average intensity, labelled as such.
 * No overlapping forecast values means "unavailable", never "dry".
 */
export function rainStateFor(qpf: GridValue[], pop: GridValue[], start: number, end: number): { state: WeatherState; avgMmPerHour: number | null; pop: number | null } {
  const overlapping = qpf.filter((v) => v.start < end && v.end > start && v.value !== null);
  const popVals = pop.filter((v) => v.start < end && v.end > start && v.value !== null).map((v) => v.value!);
  const popMax = popVals.length ? Math.max(...popVals) : null;
  if (!overlapping.length) {
    if (popMax !== null && popMax >= 50) return { state: "wet_unknown_intensity", avgMmPerHour: null, pop: popMax };
    return { state: "unavailable", avgMmPerHour: null, pop: popMax };
  }
  const rate = Math.max(...overlapping.map((v) => (v.value! / ((v.end - v.start) / 3_600_000))));
  return { state: categorizeIntensity(rate), avgMmPerHour: Math.round(rate * 10) / 10, pop: popMax };
}
