import { formatAadt, formatInt, formatMeters, formatMiles, formatRadius, periodPhrase, plural } from "./format";
import { getScenario, MODEL } from "./model";
import { ordinal } from "./normalize";
import type { AnalysisResult, ComponentId, Explanation, ScoredCandidate, ScoringModel } from "./types";

const SMALL_POPULATION = 10;
const DRIVER_MIN_SCORE = 50;

function pct(score: number | null): string {
  return score === null ? "unavailable" : ordinal(Math.floor(score + 0.5));
}

function scoreOf(s: ScoredCandidate, id: ComponentId): number | null {
  return s.breakdown.components.find((c) => c.id === id)?.score ?? null;
}

/** One sentence per scored component, built only from computed values. */
function driverSentence(id: ComponentId, s: ScoredCandidate, result: AnalysisResult): string | null {
  const f = s.features;
  const score = scoreOf(s, id);
  const period = periodPhrase(result.config.periodYears);
  switch (id) {
    case "crash":
      return `Crash evidence is in the ${pct(score)} percentile among the ${result.population} candidate locations in this analysis (${plural(f.crashes, "matched crash", "matched crashes")} in the ${period}).`;
    case "injury":
      return `${plural(f.injuryCrashes, "crash", "crashes")} involved an injury or fatality${f.fatalCrashes > 0 ? ` (${formatInt(f.fatalCrashes)} fatal)` : ""}, placing injury evidence in the ${pct(score)} percentile.`;
    case "pedestrian":
      return `This location ranks in the ${pct(score)} percentile for pedestrian-involved crash evidence (${plural(f.pedestrianCrashes, "crash", "crashes")}).`;
    case "traffic":
      if (f.aadt === null) return null;
      return s.candidate.kind === "intersection"
        ? `An estimated ${formatAadt(f.aadt)} enter this intersection (sum of the crossing roads' GDOT AADT), the ${pct(score)} percentile for traffic context.`
        : `This road carries about ${formatAadt(f.aadt)} (GDOT AADT${s.candidate.traffic.year ? `, ${s.candidate.traffic.year}` : ""}), the ${pct(score)} percentile for traffic context.`;
    case "proximity":
      return `It is approximately ${formatMiles(f.distanceM)} (${formatMeters(f.distanceM)}) from ${result.school.name}, closer than most candidates (${pct(score)} percentile for proximity).`;
  }
}

export function explainCandidate(s: ScoredCandidate, result: AnalysisResult, model: ScoringModel = MODEL): Explanation {
  const scenario = getScenario(result.config.scenario, model);
  const headline = `Ranked #${s.rank} of ${result.population} candidate locations within ${formatRadius(result.config.radiusM)} of ${result.school.name} under the ${scenario.label} scenario.`;

  // Drivers: the components contributing most to this priority, strongest first.
  const ordered = [...s.breakdown.components]
    .filter((c) => c.score !== null && c.score >= DRIVER_MIN_SCORE)
    .sort((a, b) => b.contribution - a.contribution || (b.score ?? 0) - (a.score ?? 0));
  const drivers: string[] = [];
  for (const c of ordered.slice(0, 3)) {
    const sentence = driverSentence(c.id, s, result);
    if (sentence) drivers.push(sentence);
  }

  const context: string[] = [];
  const f = s.features;
  if (f.crashes === 0) {
    context.push(`No crashes matching the current filter were matched to this location in the ${periodPhrase(result.config.periodYears)}.`);
  }
  const t = s.candidate.traffic;
  if (t.status === "unavailable") {
    context.push("No GDOT traffic count covers this location, so Traffic Context is excluded and the remaining weights are rescaled.");
  } else if (t.status === "partial") {
    context.push(`Traffic volume is partial: GDOT counts cover ${t.roadsCounted} of ${t.roadsTotal} crossing roads, so entering volume is likely underestimated.`);
  }
  if (s.candidate.kind === "intersection" && s.candidate.signal === "gdot-permitted") {
    context.push("A GDOT-permitted traffic signal is recorded at this intersection.");
  }
  const st = s.sensitivity.stability;
  if (st.level === "high") {
    context.push(`Its rank is stable across all ${model.scenarios.length} weighting scenarios (between #${st.bestRank} and #${st.worstRank}).`);
  } else if (st.level === "moderate") {
    context.push(`Its rank moves moderately with the weighting assumptions (from #${st.bestRank} to #${st.worstRank} across scenarios).`);
  } else {
    context.push(`Its rank depends strongly on the weighting assumptions (from #${st.bestRank} to #${st.worstRank} across scenarios).`);
  }

  const caveats: string[] = [];
  if (result.population < SMALL_POPULATION) {
    caveats.push(`Only ${result.population} candidate locations fall inside this radius, so percentiles move in large steps.`);
  }
  if (f.crashes > 0 && f.crashes <= 2) {
    caveats.push("The crash evidence rests on very few crashes; small counts can change substantially from year to year.");
  }
  caveats.push("CrossMetric identifies patterns in historical public data. It does not predict crashes or determine that a road is unsafe; professional review is needed to reach conclusions.");

  return { headline, drivers, context, caveats };
}

/** Context line for the analysis header, generated from state. */
export function analysisSummary(result: AnalysisResult): string {
  return `${formatInt(result.population)} candidate location${result.population === 1 ? "" : "s"} analyzed within ${formatRadius(result.config.radiusM)} of ${result.school.name}.`;
}

export function filterSummary(result: AnalysisResult, model: ScoringModel = MODEL): string {
  const filter = model.crashFilters.find((x) => x.id === result.config.crashFilter);
  const label = result.config.crashFilter === "all" ? "all reported crashes" : (filter?.label ?? "").toLowerCase();
  return `Showing ${label} from the ${periodPhrase(result.config.periodYears)}: ${plural(result.matchedCrashes, "matched crash", "matched crashes")}.`;
}

export function rankSentence(s: ScoredCandidate, result: AnalysisResult, model: ScoringModel = MODEL): string {
  return `Ranked #${s.rank} of ${result.population} under the ${getScenario(result.config.scenario, model).label} scenario.`;
}
