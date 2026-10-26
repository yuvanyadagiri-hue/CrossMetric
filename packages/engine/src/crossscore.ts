/**
 * CrossScore — route-condition model.
 *
 * CrossScore (0–100) summarizes the transportation conditions along a route
 * from public crash, road and infrastructure data. Higher means fewer risk
 * indicators were found along the route. It is decision support, never a
 * prediction or a promise of personal safety.
 *
 * Everything here is pure: the web server measures a route (crashes near it,
 * the roads it uses, recorded sidewalks...) into `RouteConditions`, and this
 * module turns those measurements into factor scores, a CrossScore, plain-
 * language reasons and the safest / balanced / fastest selection.
 */
import rawModel from "../model/crossscore-model.json";

export type TravelMode = "walk" | "bike" | "drive";
export type CrossScoreFactorId =
  | "crashHistory"
  | "severeCrashes"
  | "pedestrianCrashes"
  | "bicycleCrashes"
  | "roadSpeed"
  | "lanes"
  | "trafficVolume"
  | "sidewalks"
  | "bikeFacilities"
  | "crossings";
export type CrossScoreBandId = "lower" | "mixed" | "higher";
export type ConfidenceLevel = "high" | "moderate" | "limited";
export type CrashCategory = "all" | "injury" | "pedestrian" | "bicyclist";
/** Road setting a stretch is compared within: how busy the surrounding area is, or interstate/freeway. */
export type ContextId = "quiet" | "moderate" | "busy" | "veryBusy" | "urbanCore" | "freeway";

export interface CrossScoreBand {
  id: CrossScoreBandId;
  label: string;
  shortLabel: string;
  min: number;
}

export interface CrossScoreModel {
  version: string;
  name: string;
  released: string;
  summary: string;
  bufferM: number;
  bands: CrossScoreBand[];
  factors: { id: CrossScoreFactorId; label: string; source: string; description: string }[];
  crashScale: { averageScore: number };
  modes: Record<TravelMode, { label: string; crashFocus: CrashCategory; weights: Partial<Record<CrossScoreFactorId, number>> }>;
  speedRisk: { mph: number[]; risk: number[]; minCoverage: number; reference: string };
  laneScores: { upTo2: number; three: number; fourOrFive: number; sixPlus: number };
  volumeScores: { below9000: number; below12000: number; below15000: number; below30000: number; atLeast30000: number };
  bikeCredit: { separated: number; path: number; dedicated: number; shared: number; none: number };
  crossingCost: Record<TravelMode, { unsignalized: number; signalized: number }>;
  selection: { safestMaxTimeRatio: number; safestMaxExtraMinutes: number; balancedRatioPenalty: number; distinctOverlapMax: number };
  curb: { maxWalkM: number; nearbyM: number; weights: Partial<Record<CrossScoreFactorId, number>>; minImprovement: number };
  confidence: { high: number; moderate: number };
}

export function validateCrossScoreModel(model: CrossScoreModel): CrossScoreModel {
  const known = new Set(model.factors.map((f) => f.id));
  for (const [mode, def] of Object.entries(model.modes)) {
    for (const [id, w] of Object.entries(def.weights)) {
      if (!known.has(id as CrossScoreFactorId)) throw new Error(`Mode ${mode} weights unknown factor ${id}`);
      if (typeof w !== "number" || !(w > 0)) throw new Error(`Mode ${mode} has an invalid weight for ${id}`);
    }
  }
  const mins = model.bands.map((b) => b.min);
  for (let i = 1; i < mins.length; i++) if ((mins[i] ?? 0) >= (mins[i - 1] ?? 0)) throw new Error("CrossScore bands must descend");
  if (mins[mins.length - 1] !== 0) throw new Error("Lowest CrossScore band must start at 0");
  const { mph, risk } = model.speedRisk;
  if (mph.length !== risk.length || mph.some((v, i) => i > 0 && v <= (mph[i - 1] ?? 0))) throw new Error("speedRisk must be increasing");
  return model;
}

export const CROSSSCORE_MODEL: CrossScoreModel = validateCrossScoreModel(rawModel as CrossScoreModel);

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface CrashCounts {
  all: number;
  injury: number;
  fatal: number;
  pedestrian: number;
  bicyclist: number;
}

/**
 * Statewide references written by pipeline/publish/statewide.py, from ~1 km
 * stretches of Georgia public roads, separately for each setting: the average
 * crashes per km (`mean`) and length-weighted quantiles (`quantiles`).
 */
export interface DensityReference {
  levels: number[];
  contexts: Record<ContextId, { label: string; km: number; mean: Record<CrashCategory, number>; quantiles: Record<CrashCategory, number[]> }>;
}

/** Part of a route in one setting, with the crashes found along it. */
export interface CrashPart {
  context: ContextId;
  meters: number;
  counts: CrashCounts;
}

export interface RouteConditions {
  mode: TravelMode;
  lengthM: number;
  durationS: number;
  /** Route distance on surface streets and paths vs. interstate/freeway mainline. */
  surfaceM: number;
  freewayM: number;
  /** Crashes within the buffer, split by the setting of the stretch they are on. */
  crashParts: CrashPart[];
  /** Meters by through lanes (GDOT); roads outside the major-road index count as up to 2 lanes. */
  lanes: { upTo2M: number; threeM: number; fourOrFiveM: number; sixPlusM: number };
  /** Meters by GDOT AADT; `localM` = streets GDOT does not count, `unknownM` = major roads without a count. */
  volume: { localM: number; below9000M: number; below12000M: number; below15000M: number; below30000M: number; atLeast30000M: number; unknownM: number };
  /** Streets with a recorded posted speed (OpenStreetMap). `null` when infrastructure attributes were unavailable. */
  speed: { roadwayM: number; taggedM: number; mphMeters: number } | null;
  walkFacilities: { recordedM: number; totalM: number } | null;
  bikeFacilities: { separatedM: number; pathM: number; dedicatedM: number; sharedM: number; noneM: number } | null;
  crossings: { unsignalized: number; signalized: number };
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export interface CrossScoreFactor {
  id: CrossScoreFactorId;
  label: string;
  source: string;
  /** 0–100 condition score (higher = more favorable), or null when data was not available. */
  score: number | null;
  weight: number;
  /** Share of the CrossScore contributed by this factor (0–1); 0 when unavailable. */
  contribution: number;
  /** Short measured value, e.g. "0.6 per mile" or "2 crossings". */
  value: string;
  /** One-sentence explanation of the measurement. */
  detail: string;
}

export interface CrossScoreResult {
  mode: TravelMode;
  score: number;
  band: CrossScoreBand;
  factors: CrossScoreFactor[];
  confidence: { level: ConfidenceLevel; weightShare: number; missing: CrossScoreFactorId[] };
  positives: string[];
  concerns: string[];
  modelVersion: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const KM = 1000;
const MILE = 1609.344;

function round(x: number): number {
  return Math.floor(x + 0.5);
}

function clamp(x: number, lo = 0, hi = 100): number {
  return Math.min(hi, Math.max(lo, x));
}

function perMile(count: number, meters: number): string {
  if (meters <= 0) return "—";
  const v = count / (meters / MILE);
  return `${v < 10 ? v.toFixed(1) : round(v)} per mile`;
}

function miles(meters: number): string {
  const m = meters / MILE;
  return `${m < 0.995 ? m.toFixed(2) : m.toFixed(1)} mi`;
}

function pct(share: number): string {
  return `${round(share * 100)}%`;
}

/** Percent for "more than X% of roads" phrasing: never claims 0% or 100%. */
function rankPct(share: number): string {
  return `${Math.min(99, Math.max(1, round(share * 100)))}%`;
}

/**
 * Share (0–1) of reference mileage whose crash density is strictly below `density`.
 * The quantile table is length-weighted and non-decreasing; zero density is never "worse" than anything.
 */
export function referenceShareBelow(density: number, quantiles: number[], levels: number[]): number {
  if (!(density > 0) || quantiles.length === 0) return 0;
  let i = 0;
  while (i < quantiles.length && (quantiles[i] as number) < density) i++;
  if (i >= quantiles.length) return 1;
  if (i === 0) return 0;
  const q0 = quantiles[i - 1] as number;
  const q1 = quantiles[i] as number;
  const l0 = levels[i - 1] as number;
  const l1 = levels[i] as number;
  const t = q1 > q0 ? (density - q0) / (q1 - q0) : 1;
  return clamp(l0 + (l1 - l0) * t, 0, 100) / 100;
}

/** Score (0–100) for a ratio of observed to expected crashes: 0 -> 100, 1 (average) -> averageScore, 2 -> ~54. */
export function crashRatioScore(ratio: number, model: CrossScoreModel = CROSSSCORE_MODEL): number {
  const a = model.crashScale.averageScore;
  return 100 / (1 + Math.max(0, ratio) * ((100 - a) / a));
}

/**
 * Condition score (0–100, higher = fewer crashes) for one category: crashes
 * found along the route divided by the number expected on that much road at
 * the average rate for each part's setting.
 */
export function crashConditionScore(
  c: RouteConditions,
  category: CrashCategory,
  ref: DensityReference,
  surfaceOnly: boolean,
  model: CrossScoreModel = CROSSSCORE_MODEL,
): { score: number; ratio: number; expected: number; meters: number; count: number; comparedWith: string } {
  let meters = 0;
  let expected = 0;
  let count = 0;
  const byContext = new Map<ContextId, number>();
  for (const p of c.crashParts) {
    if (p.meters <= 0 || (surfaceOnly && p.context === "freeway")) continue;
    const r = ref.contexts[p.context];
    if (!r) continue;
    expected += r.mean[category] * (p.meters / KM);
    meters += p.meters;
    count += p.counts[category];
    byContext.set(p.context, (byContext.get(p.context) ?? 0) + p.meters);
  }
  const contexts = [...byContext.entries()].sort((a, b) => b[1] - a[1]);
  const main = contexts[0];
  let comparedWith = "similar roads";
  if (main && main[0] === "freeway") comparedWith = contexts.length > 1 ? "Georgia roads of the same type" : "Georgia interstates and freeways";
  else if (main) comparedWith = main[1] >= meters * 0.7 ? `streets in ${ref.contexts[main[0]].label}` : "streets in similar settings";
  if (meters <= 0) return { score: 100, ratio: 0, expected: 0, meters: 0, count: 0, comparedWith };
  // With no expected crashes at all (never in practice), any crash is treated as twice the average.
  const ratio = expected > 0 ? count / expected : count > 0 ? 2 : 0;
  return { score: crashRatioScore(ratio, model), ratio, expected, meters, count, comparedWith };
}

function ratioPhrase(ratio: number): string {
  if (ratio <= 0) return "none";
  if (ratio < 0.95) return `${Math.max(1, round((1 - ratio) * 100))}% below the average`;
  if (ratio <= 1.05) return "about the average";
  return `${ratio < 10 ? ratio.toFixed(1) : round(ratio)}× the average`;
}

/** Score (0–100) for a posted speed: 100 × (1 − pedestrian risk of death at that impact speed). */
export function speedScore(mph: number, model: CrossScoreModel = CROSSSCORE_MODEL): number {
  const { mph: xs, risk } = model.speedRisk;
  if (mph <= (xs[0] as number)) return 100 * (1 - (risk[0] as number));
  for (let i = 1; i < xs.length; i++) {
    const x1 = xs[i] as number;
    if (mph <= x1) {
      const x0 = xs[i - 1] as number;
      const r = (risk[i - 1] as number) + (((risk[i] as number) - (risk[i - 1] as number)) * (mph - x0)) / (x1 - x0);
      return 100 * (1 - r);
    }
  }
  return 100 * (1 - (risk[risk.length - 1] as number));
}

export function crossScoreBand(score: number, model: CrossScoreModel = CROSSSCORE_MODEL): CrossScoreBand {
  for (const b of model.bands) if (score >= b.min) return b;
  return model.bands[model.bands.length - 1] as CrossScoreBand;
}

function factorMeta(id: CrossScoreFactorId, model: CrossScoreModel) {
  const f = model.factors.find((x) => x.id === id);
  if (!f) throw new Error(`Unknown factor ${id}`);
  return f;
}

// ---------------------------------------------------------------------------
// Factor measurement
// ---------------------------------------------------------------------------

interface Measured {
  score: number | null;
  value: string;
  detail: string;
  positive?: string;
  concern?: string;
}

function measure(id: CrossScoreFactorId, c: RouteConditions, ref: DensityReference, model: CrossScoreModel): Measured {
  const walkOrBike = c.mode !== "drive";
  switch (id) {
    case "crashHistory":
    case "severeCrashes":
    case "pedestrianCrashes":
    case "bicycleCrashes": {
      const category: CrashCategory =
        id === "crashHistory" ? "all" : id === "severeCrashes" ? "injury" : id === "pedestrianCrashes" ? "pedestrian" : "bicyclist";
      const r = crashConditionScore(c, category, ref, walkOrBike || category === "pedestrian" || category === "bicyclist", model);
      const noun = { all: "reported crashes", injury: "injury or fatal crashes", pedestrian: "crashes involving a pedestrian", bicyclist: "crashes involving a bicyclist" }[category];
      const comparedWith = r.comparedWith;
      const value = perMile(r.count, r.meters);
      const expected = r.expected < 0.95 ? r.expected.toFixed(1) : String(round(r.expected));
      const detail =
        r.count === 0
          ? `No ${noun} were reported within ${model.bufferM} m of this route in the data window (about ${expected} would be typical for ${comparedWith}).`
          : `${r.count} ${noun} within ${model.bufferM} m (${value}) — ${ratioPhrase(r.ratio)} for ${comparedWith}, where about ${expected} would be typical.`;
      const lead = { all: "Crash history", injury: "Injury and fatal crashes", pedestrian: "Pedestrian incidents", bicyclist: "Bicycle incidents" }[category];
      return {
        score: r.score,
        value,
        detail,
        positive: r.count === 0 ? `No ${noun} recorded along the route` : r.ratio <= 0.6 ? `${lead} ${ratioPhrase(r.ratio)} for ${comparedWith}` : undefined,
        concern: r.ratio >= 1.8 && r.count >= 2 ? `${lead}: ${r.count} near the route, ${ratioPhrase(r.ratio)} for ${comparedWith}` : undefined,
      };
    }
    case "roadSpeed": {
      const s = c.speed;
      if (!s || s.roadwayM <= 0) {
        return { score: walkOrBike && s ? 100 : null, value: s ? "No streets" : "Unavailable", detail: s ? "The route stays on paths away from streets." : "Street attributes were not available for this route." };
      }
      const coverage = s.taggedM / s.roadwayM;
      if (coverage < model.speedRisk.minCoverage || s.taggedM <= 0) {
        return { score: null, value: "Not recorded", detail: `A posted speed limit is recorded on only ${pct(coverage)} of the streets used, too little to score.` };
      }
      const mph = s.mphMeters / s.taggedM;
      const score = speedScore(mph, model);
      return {
        score,
        value: `${round(mph)} mph average`,
        detail: `Average posted limit ${round(mph)} mph on the ${pct(coverage)} of street distance with a recorded limit.`,
        positive: mph <= 30 ? "Mostly low-speed streets (30 mph or less)" : undefined,
        concern: mph >= 40 ? `Streets average ${round(mph)} mph where limits are recorded` : undefined,
      };
    }
    case "lanes": {
      const l = c.lanes;
      const total = l.upTo2M + l.threeM + l.fourOrFiveM + l.sixPlusM;
      if (total <= 0) return { score: null, value: "Unavailable", detail: "Road attributes were not available." };
      const ls = model.laneScores;
      const score = (l.upTo2M * ls.upTo2 + l.threeM * ls.three + l.fourOrFiveM * ls.fourOrFive + l.sixPlusM * ls.sixPlus) / total;
      const wide = l.fourOrFiveM + l.sixPlusM;
      return {
        score,
        value: wide > 0 ? `${miles(wide)} on 4+ lanes` : "1–2 lanes",
        detail:
          wide + l.threeM > 0
            ? `${pct((l.threeM + wide) / total)} of the route is on or beside roads with 3 or more through lanes (${miles(wide)} with 4 or more).`
            : "The route stays on roads with one or two through lanes.",
        positive: wide === 0 && l.threeM === 0 ? "Stays on one- and two-lane streets" : undefined,
        concern: wide / total >= 0.3 ? `${pct(wide / total)} of the route is beside roads with 4+ lanes` : undefined,
      };
    }
    case "trafficVolume": {
      const v = c.volume;
      const vs = model.volumeScores;
      const known = v.localM + v.below9000M + v.below12000M + v.below15000M + v.below30000M + v.atLeast30000M;
      if (known <= 0) return { score: null, value: "Unavailable", detail: "No traffic counts apply to this route." };
      const score =
        ((v.localM + v.below9000M) * vs.below9000 + v.below12000M * vs.below12000 + v.below15000M * vs.below15000 + v.below30000M * vs.below30000 + v.atLeast30000M * vs.atLeast30000) /
        known;
      const busy = v.below30000M + v.atLeast30000M;
      return {
        score,
        value: busy > 0 ? `${miles(busy)} over 15,000/day` : "Lower volume",
        detail:
          busy > 0
            ? `${miles(busy)} of the route uses roads carrying more than 15,000 vehicles a day (GDOT counts).${v.unknownM > 0 ? ` ${miles(v.unknownM)} of major road has no count and is not scored.` : ""}`
            : `No road on the route carries more than 15,000 vehicles a day in GDOT counts.${v.unknownM > 0 ? ` ${miles(v.unknownM)} of major road has no count.` : ""}`,
        positive: busy === 0 ? "Avoids roads with more than 15,000 vehicles a day" : undefined,
        concern: busy / known >= 0.3 ? `${pct(busy / known)} of the route is on high-volume roads` : undefined,
      };
    }
    case "sidewalks": {
      const w = c.walkFacilities;
      if (!w || w.totalM <= 0) return { score: null, value: "Unavailable", detail: "Sidewalk data was not available for this route." };
      const share = w.recordedM / w.totalM;
      return {
        score: share * 100,
        value: `${pct(share)} recorded`,
        detail: `${pct(share)} of the walk is on a footpath or a street with a sidewalk recorded in OpenStreetMap. Unrecorded is not the same as missing.`,
        positive: share >= 0.75 ? `Sidewalks or footpaths recorded on ${pct(share)} of the walk` : undefined,
        concern: share < 0.4 ? `Sidewalks recorded on only ${pct(share)} of the walk` : undefined,
      };
    }
    case "bikeFacilities": {
      const b = c.bikeFacilities;
      const total = b ? b.separatedM + b.pathM + b.dedicatedM + b.sharedM + b.noneM : 0;
      if (!b || total <= 0) return { score: null, value: "Unavailable", detail: "Bike facility data was not available for this route." };
      const bc = model.bikeCredit;
      const credit = b.separatedM * bc.separated + b.pathM * bc.path + b.dedicatedM * bc.dedicated + b.sharedM * bc.shared + b.noneM * bc.none;
      const protectedShare = (b.separatedM + b.pathM) / total;
      return {
        score: (credit / total) * 100,
        value: `${pct(protectedShare)} protected`,
        detail: `${pct(protectedShare)} on separated paths or protected lanes, ${pct(b.dedicatedM / total)} in painted bike lanes, ${pct(b.sharedM / total)} with shared-lane markings (OpenStreetMap).`,
        positive: protectedShare >= 0.5 ? `${pct(protectedShare)} of the ride on protected paths or lanes` : undefined,
        concern: protectedShare + b.dedicatedM / total < 0.2 ? "Little recorded bike infrastructure" : undefined,
      };
    }
    case "crossings": {
      const x = c.crossings;
      const cost = model.crossingCost[c.mode];
      const score = clamp(100 - x.unsignalized * cost.unsignalized - x.signalized * cost.signalized);
      const n = x.unsignalized + x.signalized;
      return {
        score,
        value: n === 0 ? "None" : `${n} crossing${n === 1 ? "" : "s"}`,
        detail:
          n === 0
            ? "The route does not cross an arterial or a road with 4+ lanes."
            : `Crosses an arterial or 4+ lane road ${n} time${n === 1 ? "" : "s"}: ${x.signalized} with a GDOT traffic signal record, ${x.unsignalized} without.`,
        positive: n === 0 ? "No crossings of major roads" : x.unsignalized === 0 ? "Every major-road crossing has a traffic signal record" : undefined,
        concern: x.unsignalized > 0 ? `${x.unsignalized} major-road crossing${x.unsignalized === 1 ? "" : "s"} without a traffic signal record` : undefined,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// CrossScore
// ---------------------------------------------------------------------------

function combine(
  ids: [CrossScoreFactorId, number][],
  measured: (id: CrossScoreFactorId) => Measured,
  model: CrossScoreModel,
): { score: number; factors: CrossScoreFactor[]; measures: Measured[]; weightShare: number; missing: CrossScoreFactorId[] } {
  const ms = ids.map(([id]) => measured(id));
  const totalWeight = ids.reduce((s, [, w]) => s + w, 0);
  const used = ids.reduce((s, [, w], i) => s + (ms[i]!.score === null ? 0 : w), 0);
  const raw = used > 0 ? ids.reduce((s, [, w], i) => s + (ms[i]!.score === null ? 0 : w * (ms[i]!.score as number)), 0) / used : 0;
  const factors = ids.map(([id, w], i): CrossScoreFactor => {
    const m = ms[i]!;
    const meta = factorMeta(id, model);
    return {
      id,
      label: meta.label,
      source: meta.source,
      score: m.score === null ? null : round(m.score),
      weight: w,
      contribution: m.score === null || used <= 0 || raw <= 0 ? 0 : (w * m.score) / used / raw,
      value: m.value,
      detail: m.detail,
    };
  });
  return {
    score: round(clamp(raw)),
    factors,
    measures: ms,
    weightShare: totalWeight > 0 ? used / totalWeight : 0,
    missing: ids.filter((_, i) => ms[i]!.score === null).map(([id]) => id),
  };
}

export function computeCrossScore(c: RouteConditions, ref: DensityReference, model: CrossScoreModel = CROSSSCORE_MODEL): CrossScoreResult {
  const weights = model.modes[c.mode].weights;
  const ids = Object.entries(weights) as [CrossScoreFactorId, number][];
  const r = combine(ids, (id) => measure(id, c, ref, model), model);
  const level: ConfidenceLevel = r.weightShare >= model.confidence.high ? "high" : r.weightShare >= model.confidence.moderate ? "moderate" : "limited";
  // Reasons in order of the factor's weight so the most important come first.
  const order = ids.map((_, i) => i).sort((a, b) => (ids[b]![1] - ids[a]![1]) || a - b);
  const positives = order.map((i) => r.measures[i]!.positive).filter((s): s is string => !!s);
  const concerns = order.map((i) => r.measures[i]!.concern).filter((s): s is string => !!s);
  return {
    mode: c.mode,
    score: r.score,
    band: crossScoreBand(r.score, model),
    factors: r.factors,
    confidence: { level, weightShare: r.weightShare, missing: r.missing },
    positives,
    concerns,
    modelVersion: model.version,
  };
}

// ---------------------------------------------------------------------------
// Safest / balanced / fastest
// ---------------------------------------------------------------------------

export type RouteRole = "safest" | "balanced" | "fastest";

export interface RouteCandidateSummary {
  id: string;
  durationS: number;
  score: number;
}

export interface RouteSelection {
  /** Route id chosen for each role. A route can fill several roles. */
  roles: Record<RouteRole, string>;
  /** Distinct routes in display order (safest first), each with the roles it fills. */
  options: { id: string; roles: RouteRole[] }[];
}

export function balancedUtility(score: number, durationS: number, fastestS: number, model: CrossScoreModel = CROSSSCORE_MODEL): number {
  const ratio = fastestS > 0 ? durationS / fastestS : 1;
  return score - model.selection.balancedRatioPenalty * Math.max(0, ratio - 1);
}

/**
 * Fastest = shortest travel time. Safest = highest CrossScore among routes no
 * more than 60% (and 20 minutes) slower than the fastest — a practical limit.
 * Balanced = highest CrossScore after a time penalty (25 points per 100% extra time).
 * Ties break toward the faster route, then the id, so the choice is deterministic.
 */
export function selectRoutes(cands: RouteCandidateSummary[], model: CrossScoreModel = CROSSSCORE_MODEL): RouteSelection {
  if (cands.length === 0) throw new Error("No routes to select from");
  const byTime = [...cands].sort((a, b) => a.durationS - b.durationS || a.id.localeCompare(b.id));
  const fastest = byTime[0]!;
  const limit = Math.min(fastest.durationS * model.selection.safestMaxTimeRatio, fastest.durationS + model.selection.safestMaxExtraMinutes * 60);
  const practical = byTime.filter((c) => c.durationS <= limit + 1e-9);
  const best = (score: (c: RouteCandidateSummary) => number) =>
    practical.reduce((a, b) => (score(b) > score(a) + 1e-9 ? b : a), practical[0]!);
  const safest = best((c) => c.score);
  const balanced = best((c) => balancedUtility(c.score, c.durationS, fastest.durationS, model));
  const roles: Record<RouteRole, string> = { safest: safest.id, balanced: balanced.id, fastest: fastest.id };
  const options: { id: string; roles: RouteRole[] }[] = [];
  for (const role of ["safest", "balanced", "fastest"] as RouteRole[]) {
    const id = roles[role];
    const existing = options.find((o) => o.id === id);
    if (existing) existing.roles.push(role);
    else options.push({ id, roles: [role] });
  }
  return { roles, options };
}

// ---------------------------------------------------------------------------
// Safer pickup / drop-off
// ---------------------------------------------------------------------------

export interface CurbConditions {
  id: string;
  walkM: number;
  /** Setting of the curb point (how busy the surrounding area is). */
  context: Exclude<ContextId, "freeway">;
  /** Crashes within `curb.nearbyM` of the curb point. */
  crashes: CrashCounts;
  lanes: number | null;
  aadt: number | null;
  /** Posted speed limit (OpenStreetMap) when recorded. */
  speedMph: number | null;
  /** True when the curb is on a street GDOT does not classify as a major road. */
  localStreet: boolean;
}

export interface CurbScore {
  id: string;
  score: number;
  band: CrossScoreBand;
  factors: { id: CrossScoreFactorId; label: string; score: number | null; value: string }[];
}

export function scoreCurb(p: CurbConditions, ref: DensityReference, model: CrossScoreModel = CROSSSCORE_MODEL): CurbScore {
  const stretchKm = (model.curb.nearbyM * 2) / KM;
  const mean = ref.contexts[p.context].mean;
  const density = (n: number, cat: CrashCategory) => crashRatioScore(mean[cat] > 0 ? n / (mean[cat] * stretchKm) : n > 0 ? 2 : 0, model);
  const ls = model.laneScores;
  const vs = model.volumeScores;
  const lanes = p.lanes === null ? (p.localStreet ? 2 : null) : p.lanes;
  const values: Record<string, { score: number | null; value: string }> = {
    pedestrianCrashes: { score: density(p.crashes.pedestrian, "pedestrian"), value: `${p.crashes.pedestrian} pedestrian crash${p.crashes.pedestrian === 1 ? "" : "es"} within ${model.curb.nearbyM} m` },
    crashHistory: { score: density(p.crashes.all, "all"), value: `${p.crashes.all} crash${p.crashes.all === 1 ? "" : "es"} within ${model.curb.nearbyM} m` },
    lanes: {
      score: lanes === null ? null : lanes <= 2 ? ls.upTo2 : lanes === 3 ? ls.three : lanes <= 5 ? ls.fourOrFive : ls.sixPlus,
      value: lanes === null ? "Unknown" : `${lanes} lane${lanes === 1 ? "" : "s"}`,
    },
    trafficVolume: {
      score: p.aadt === null ? (p.localStreet ? vs.below9000 : null) : p.aadt < 9000 ? vs.below9000 : p.aadt < 12000 ? vs.below12000 : p.aadt < 15000 ? vs.below15000 : p.aadt < 30000 ? vs.below30000 : vs.atLeast30000,
      value: p.aadt === null ? (p.localStreet ? "Local street" : "No count") : `${p.aadt.toLocaleString("en-US")} vehicles/day`,
    },
    roadSpeed: { score: p.speedMph === null ? null : speedScore(p.speedMph, model), value: p.speedMph === null ? "Not recorded" : `${p.speedMph} mph` },
  };
  const ids = Object.entries(model.curb.weights) as [CrossScoreFactorId, number][];
  let used = 0;
  let sum = 0;
  for (const [id, w] of ids) {
    const s = values[id]?.score;
    if (s === null || s === undefined) continue;
    used += w;
    sum += w * s;
  }
  const score = used > 0 ? round(sum / used) : 0;
  return {
    id: p.id,
    score,
    band: crossScoreBand(score, model),
    factors: ids.map(([id]) => ({ id, label: factorMeta(id, model).label, score: values[id]?.score === null || values[id]?.score === undefined ? null : round(values[id]!.score as number), value: values[id]?.value ?? "" })),
  };
}

/** Plain-language reasons an alternative curb point compares favorably with the current one. */
export function curbReasons(current: CurbConditions, alt: CurbConditions): string[] {
  const reasons: string[] = [];
  if (current.speedMph !== null && alt.speedMph !== null && alt.speedMph < current.speedMph) reasons.push(`Lower posted speed (${alt.speedMph} vs ${current.speedMph} mph)`);
  const cl = current.lanes ?? (current.localStreet ? 2 : null);
  const al = alt.lanes ?? (alt.localStreet ? 2 : null);
  if (cl !== null && al !== null && al < cl) reasons.push(`Fewer lanes (${al} vs ${cl})`);
  if (alt.localStreet && !current.localStreet) reasons.push("On a local street instead of a major road");
  else if (current.aadt !== null && (alt.aadt ?? 0) < current.aadt * 0.75) reasons.push("Lower traffic volume");
  if (alt.crashes.pedestrian < current.crashes.pedestrian) reasons.push("Fewer pedestrian crashes nearby");
  else if (alt.crashes.all < current.crashes.all) reasons.push("Fewer reported crashes nearby");
  return reasons;
}

/** Route overlap (0–1) by shared 25 m grid cells — used to drop near-duplicate alternatives. */
export function routeOverlap(a: [number, number][], b: [number, number][]): number {
  const cells = (pts: [number, number][]) => {
    const set = new Set<string>();
    for (const [lon, lat] of pts) set.add(`${Math.round(lon / 0.00028)}:${Math.round(lat / 0.000225)}`);
    return set;
  };
  const ca = cells(a);
  const cb = cells(b);
  let shared = 0;
  for (const k of ca) if (cb.has(k)) shared++;
  return shared / Math.max(1, Math.min(ca.size, cb.size));
}
