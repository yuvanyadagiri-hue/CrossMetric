import { computeFeatures, periodWindow } from "./features";
import { bandFor, getScenario, MODEL, SCENARIO_IDS } from "./model";
import { percentileScores, roundHalfUp } from "./normalize";
import { rankingStability } from "./sensitivity";
import type {
  AnalysisConfiguration,
  AnalysisResult,
  CandidateFeatures,
  ComponentId,
  MeasureId,
  PriorityBandId,
  ScenarioId,
  SchoolPackage,
  ScoreBreakdown,
  ScoredCandidate,
  ScoringModel,
} from "./types";

function measureValue(f: CandidateFeatures, measure: MeasureId): number | null {
  switch (measure) {
    case "crashes":
      return f.crashes;
    case "injuryCrashes":
      return f.injuryCrashes;
    case "pedestrianCrashes":
      return f.pedestrianCrashes;
    case "aadt":
      return f.aadt;
    case "distanceM":
      return f.distanceM;
  }
}

/** Percentile score of every component for every candidate in the population. */
export function componentScores(features: CandidateFeatures[], model: ScoringModel = MODEL): Record<ComponentId, (number | null)[]> {
  const out = {} as Record<ComponentId, (number | null)[]>;
  for (const comp of model.components) {
    out[comp.id] = percentileScores(
      features.map((f) => measureValue(f, comp.measure)),
      { lowerIsPriority: comp.direction === "lower-is-priority", evidence: comp.kind === "evidence" },
    );
  }
  return out;
}

/**
 * priority = sum(w_i * s_i) / sum(w_i) over components with data.
 * Components are summed in the model's fixed order so the floating-point
 * result is bit-identical to the Python reference implementation.
 */
export function combine(
  scores: Record<ComponentId, (number | null)[]>,
  i: number,
  scenarioId: ScenarioId,
  model: ScoringModel = MODEL,
): { priority: number; breakdown: ScoreBreakdown } {
  const weights = getScenario(scenarioId, model).weights;
  let num = 0;
  let den = 0;
  const excluded: ComponentId[] = [];
  for (const comp of model.components) {
    const s = scores[comp.id][i] ?? null;
    if (s === null) {
      excluded.push(comp.id);
      continue;
    }
    num = num + weights[comp.id] * s;
    den = den + weights[comp.id];
  }
  const priority = den > 0 ? num / den : 0;
  const components = model.components.map((comp) => {
    const s = scores[comp.id][i] ?? null;
    const w = weights[comp.id];
    return {
      id: comp.id,
      label: comp.label,
      score: s,
      rawValue: null as number | null,
      unit: comp.unit,
      weight: w,
      contribution: s === null || num === 0 ? 0 : (w * s) / num,
    };
  });
  return { priority, breakdown: { components, weightUsed: den, excluded } };
}

/** 1-based ranks; ties broken by crashes desc, distance asc, id asc (model.combination.tieBreak). */
export function rankOrder(priorities: number[], features: CandidateFeatures[], ids: string[]): number[] {
  const order = priorities.map((_, i) => i);
  order.sort((a, b) => {
    const pa = priorities[a] as number;
    const pb = priorities[b] as number;
    if (pa !== pb) return pb - pa;
    const fa = features[a] as CandidateFeatures;
    const fb = features[b] as CandidateFeatures;
    if (fa.crashes !== fb.crashes) return fb.crashes - fa.crashes;
    if (fa.distanceM !== fb.distanceM) return fa.distanceM - fb.distanceM;
    const ia = ids[a] as string;
    const ib = ids[b] as string;
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  });
  const ranks = new Array<number>(priorities.length);
  order.forEach((idx, r) => {
    ranks[idx] = r + 1;
  });
  return ranks;
}

/**
 * Run a complete analysis for one school package under one configuration.
 * Pure function: same package + configuration => same result.
 */
export function runAnalysis(pkg: SchoolPackage, config: AnalysisConfiguration, model: ScoringModel = MODEL): AnalysisResult {
  const allFeatures = computeFeatures(pkg, config);
  const members: number[] = [];
  pkg.candidates.forEach((c, i) => {
    if (c.distanceM <= config.radiusM) members.push(i);
  });
  const features = members.map((i) => allFeatures[i] as CandidateFeatures);
  const ids = members.map((i) => pkg.candidates[i]?.id as string);
  const scores = componentScores(features, model);

  const byScenario = {} as Record<ScenarioId, { priorities: number[]; ranks: number[] }>;
  for (const sid of SCENARIO_IDS) {
    const priorities = features.map((_, i) => combine(scores, i, sid, model).priority);
    byScenario[sid] = { priorities, ranks: rankOrder(priorities, features, ids) };
  }

  const n = members.length;
  const scored: ScoredCandidate[] = members.map((pkgIndex, i) => {
    const { priority, breakdown } = combine(scores, i, config.scenario, model);
    const f = features[i] as CandidateFeatures;
    for (const comp of breakdown.components) {
      const m = model.components.find((c) => c.id === comp.id);
      comp.rawValue = m ? measureValue(f, m.measure) : null;
    }
    const ranks = {} as Record<ScenarioId, number>;
    const priorities = {} as Record<ScenarioId, number>;
    for (const sid of SCENARIO_IDS) {
      ranks[sid] = byScenario[sid].ranks[i] as number;
      priorities[sid] = byScenario[sid].priorities[i] as number;
    }
    const displayPriority = roundHalfUp(priority);
    return {
      candidate: pkg.candidates[pkgIndex]!,
      index: pkgIndex,
      features: f,
      breakdown,
      priority,
      displayPriority,
      band: bandFor(displayPriority, model),
      rank: ranks[config.scenario],
      sensitivity: { ranks, priorities, stability: rankingStability(Object.values(ranks), n, model) },
    };
  });
  scored.sort((a, b) => a.rank - b.rank);

  const bandCounts: Record<PriorityBandId, number> = { high: 0, elevated: 0, moderate: 0, lower: 0 };
  let matchedCrashes = 0;
  for (const s of scored) {
    bandCounts[s.band.id] += 1;
    matchedCrashes += s.features.crashes;
  }
  const pw = periodWindow(pkg, config.periodYears);
  return {
    config,
    school: pkg.school,
    model: { version: model.version, released: model.released },
    periodWindow: { start: pw.start, end: pw.end },
    population: n,
    candidates: scored,
    matchedCrashes,
    bandCounts,
  };
}
