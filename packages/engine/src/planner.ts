import { geometryDistanceM } from "./geo";
import { MODEL, SCENARIO_IDS } from "./model";
import type { AnalysisResult, PlannerResult, PlannerSelection, PlannerSkip, ScoringModel } from "./types";

export const MAX_CAPACITY = 50;

/**
 * Resource Planner: given capacity for N professional reviews, choose the N
 * highest-priority locations from the current analysis.
 *
 * Geographic de-duplication: walking down the ranked list, a candidate is
 * skipped when it lies within `coverageRadiusM` of an already-selected
 * location AND shares a road with it — one site review would naturally cover
 * both (for example an intersection and the 100 m of road leading into it).
 * Skipped candidates are reported, never silently dropped.
 *
 * Robustness: a selection is "robust" when its rank is within the top N under
 * every weighting scenario, i.e. the recommendation doesn't hinge on one
 * weighting assumption.
 */
export function planReviews(result: AnalysisResult, capacity: number, model: ScoringModel = MODEL): PlannerResult {
  const cap = Math.max(1, Math.min(MAX_CAPACITY, Math.floor(capacity)));
  const radius = model.planner.coverageRadiusM;
  const refLat = result.school.lat;
  const selections: PlannerSelection[] = [];
  const skipped: PlannerSkip[] = [];

  for (const scored of result.candidates) {
    if (selections.length >= cap) break;
    let coveredBy: { slot: number; distanceM: number; sharedRoad: string } | null = null;
    for (const sel of selections) {
      const shared = scored.candidate.roads.find((r) => r !== "Unnamed road" && sel.scored.candidate.roads.includes(r));
      if (!shared) continue;
      const d = geometryDistanceM(scored.candidate.geometry, sel.scored.candidate.geometry, refLat);
      if (d <= radius) {
        coveredBy = { slot: sel.slot, distanceM: d, sharedRoad: shared };
        break;
      }
    }
    if (coveredBy) {
      skipped.push({ scored, coveredBySlot: coveredBy.slot, distanceM: coveredBy.distanceM, sharedRoad: coveredBy.sharedRoad });
      continue;
    }
    selections.push({ slot: selections.length + 1, scored, robust: false });
  }

  // Robust = inside the top-N (N = number of slots actually filled) under every scenario.
  const n = selections.length;
  for (const sel of selections) {
    sel.robust = SCENARIO_IDS.every((sid) => sel.scored.sensitivity.ranks[sid] <= n + skipped.length);
  }
  return {
    capacity: cap,
    selections,
    skipped,
    robustCount: selections.filter((s) => s.robust).length,
    exhausted: selections.length < cap,
  };
}

export function plannerSummary(plan: PlannerResult, result: AnalysisResult): string {
  const filled = plan.selections.length;
  if (filled === 0) return `No candidate locations are available in the current analysis of ${result.school.name}.`;
  const base = `Planning for ${plan.capacity} professional review${plan.capacity === 1 ? "" : "s"} around ${result.school.name} using the current analysis.`;
  return plan.exhausted ? `${base} Only ${filled} distinct location${filled === 1 ? " is" : "s are"} available.` : base;
}
