import { MODEL } from "./model";
import type { RankingStability, ScoringModel } from "./types";

/**
 * Ranking stability (model.stability).
 *
 * spread = worst rank - best rank across every scenario.
 *   High      spread <= max(2, ceil(10% of N))
 *   Moderate  spread <= max(4, ceil(25% of N))
 *   Low       otherwise
 *
 * The tolerance grows with N because moving 3 places means more in a list of
 * 8 candidates than in a list of 120.
 */
export function stabilityTolerances(n: number, model: ScoringModel = MODEL): { high: number; moderate: number } {
  const { high, moderate } = model.stability;
  return {
    high: Math.max(high.minPositions, Math.ceil(high.shareOfCandidates * n)),
    moderate: Math.max(moderate.minPositions, Math.ceil(moderate.shareOfCandidates * n)),
  };
}

export function rankingStability(ranks: number[], n: number, model: ScoringModel = MODEL): RankingStability {
  const bestRank = Math.min(...ranks);
  const worstRank = Math.max(...ranks);
  const spread = worstRank - bestRank;
  const tolerance = stabilityTolerances(n, model);
  const level = spread <= tolerance.high ? "high" : spread <= tolerance.moderate ? "moderate" : "low";
  return { level, bestRank, worstRank, spread, tolerance };
}
