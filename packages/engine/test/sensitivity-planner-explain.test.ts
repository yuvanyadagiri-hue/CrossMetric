import { describe, expect, it } from "vitest";
import { analysisSummary, explainCandidate, filterSummary } from "../src/explain";
import { addMonthsClamped, crashesForCandidate } from "../src/features";
import { formatAadt, formatInt, formatMiles, formatScore } from "../src/format";
import { planReviews } from "../src/planner";
import { runAnalysis } from "../src/score";
import { rankingStability, stabilityTolerances } from "../src/sensitivity";
import type { AnalysisConfiguration } from "../src/types";
import { candidate, many, pkg } from "./fixtures";

const base: AnalysisConfiguration = { radiusM: 800, periodYears: 3, crashFilter: "all", scenario: "standard" };

describe("ranking stability", () => {
  it("scales tolerance with the number of candidates", () => {
    expect(stabilityTolerances(8)).toEqual({ high: 2, moderate: 4 });
    expect(stabilityTolerances(40)).toEqual({ high: 4, moderate: 10 });
    expect(stabilityTolerances(120)).toEqual({ high: 12, moderate: 30 });
  });

  it("classifies by rank spread across scenarios", () => {
    expect(rankingStability([2, 1, 4, 3], 40)).toMatchObject({ level: "high", bestRank: 1, worstRank: 4, spread: 3 });
    expect(rankingStability([2, 9, 4, 3], 40)).toMatchObject({ level: "moderate", spread: 7 });
    expect(rankingStability([2, 19, 4, 3], 40)).toMatchObject({ level: "low", spread: 17 });
  });
});

describe("Resource Planner", () => {
  const roadA = "Alpha Rd";
  const p = pkg(
    [
      // two candidates 40 m apart on the same road -> second is covered by the first
      candidate("I1", { roads: [roadA, "Beta St"], geometry: { type: "Point", coordinates: [-84.2, 34.0] } }),
      candidate("S1", {
        kind: "segment",
        roads: [roadA],
        distanceM: 120,
        geometry: { type: "LineString", coordinates: [[-84.2, 34.00036], [-84.2, 34.0012]] },
      }),
      candidate("I2", { roads: ["Gamma Rd", "Delta St"], distanceM: 300, geometry: { type: "Point", coordinates: [-84.21, 34.0] } }),
      candidate("I3", { roads: ["Epsilon Rd", "Zeta St"], distanceM: 400, geometry: { type: "Point", coordinates: [-84.22, 34.0] } }),
    ],
    [...many(0, 9, { injury: true }), ...many(1, 8, { injury: true }), ...many(2, 5), ...many(3, 1)],
  );

  it("returns exactly the requested number of distinct locations, in rank order", () => {
    const r = runAnalysis(p, base);
    const plan = planReviews(r, 2);
    expect(plan.selections.map((s) => s.scored.candidate.id)).toEqual(["I1", "I2"]);
    expect(plan.selections.map((s) => s.slot)).toEqual([1, 2]);
  });

  it("skips a candidate covered by an already-selected location on a shared road", () => {
    const plan = planReviews(runAnalysis(p, base), 2);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0]!.scored.candidate.id).toBe("S1");
    expect(plan.skipped[0]!.coveredBySlot).toBe(1);
    expect(plan.skipped[0]!.sharedRoad).toBe(roadA);
    expect(plan.skipped[0]!.distanceM).toBeLessThan(100);
  });

  it("reports when capacity exceeds the distinct locations available", () => {
    const plan = planReviews(runAnalysis(p, base), 10);
    expect(plan.selections).toHaveLength(3);
    expect(plan.exhausted).toBe(true);
  });

  it("responds to the scenario it inherits", () => {
    const r1 = planReviews(runAnalysis(p, base), 1);
    expect(r1.selections[0]!.scored.candidate.id).toBe("I1");
    const ped = pkg(p.candidates, [...many(0, 9), ...many(3, 1, { pedestrian: true })]);
    const r2 = planReviews(runAnalysis(ped, { ...base, crashFilter: "pedestrian" }), 1);
    expect(r2.selections[0]!.scored.candidate.id).toBe("I3");
  });

  it("clamps capacity to a sane range", () => {
    expect(planReviews(runAnalysis(p, base), 0).capacity).toBe(1);
    expect(planReviews(runAnalysis(p, base), 999).capacity).toBe(50);
  });
});

describe("explanations", () => {
  const p = pkg(
    [
      candidate("A", { name: "Alpha Rd & Beta St", distanceM: 290 }),
      candidate("B", { distanceM: 600, traffic: { aadt: null, year: null, status: "unavailable", roadsCounted: 0, roadsTotal: 2 } }),
      candidate("C", { distanceM: 700 }),
    ],
    [...many(0, 6, { injury: true }), ...many(0, 2, { pedestrian: true }), ...many(2, 1)],
  );
  const r = runAnalysis(p, base);

  it("generates a headline from the actual rank, population, radius, school and scenario", () => {
    const e = explainCandidate(r.candidates[0]!, r);
    expect(e.headline).toBe("Ranked #1 of 3 candidate locations within 800 m of Synthetic Test School under the Standard (Balanced) scenario.");
  });

  it("explains drivers with real percentiles and counts", () => {
    const e = explainCandidate(r.candidates[0]!, r);
    expect(e.drivers.join(" ")).toMatch(/100th percentile/);
    expect(e.drivers.join(" ")).toMatch(/8 matched crashes in the full data window/);
    expect(e.drivers.join(" ")).toMatch(/pedestrian-involved crash evidence \(2 crashes\)/);
  });

  it("says plainly when traffic data is unavailable and when no crashes matched", () => {
    const b = r.candidates.find((c) => c.candidate.id === "B")!;
    const e = explainCandidate(b, r);
    expect(e.context.join(" ")).toMatch(/No GDOT traffic count covers this location/);
    expect(e.context.join(" ")).toMatch(/No crashes matching the current filter/);
  });

  it("always includes the responsible-use caveat and never claims danger", () => {
    for (const s of r.candidates) {
      const text = Object.values(explainCandidate(s, r)).flat().join(" ");
      expect(text).toMatch(/does not predict crashes/);
      expect(text).not.toMatch(/\bdangerous\b|\bunsafe road\b|will happen/i);
    }
  });

  it("flags small analysis populations", () => {
    expect(explainCandidate(r.candidates[0]!, r).caveats.join(" ")).toMatch(/Only 3 candidate locations/);
  });

  it("produces state-driven summaries", () => {
    expect(analysisSummary(r)).toBe("3 candidate locations analyzed within 800 m of Synthetic Test School.");
    const ped = runAnalysis(p, { ...base, crashFilter: "pedestrian", periodYears: 1 });
    expect(filterSummary(ped)).toBe("Showing pedestrian-involved crashes from the most recent 12 months: 2 matched crashes.");
  });
});

describe("crash records and formatting", () => {
  it("decodes crashes for a candidate, newest first", () => {
    const p = pkg([candidate("A")], [{ candidate: 0, day: 0, injury: true }, { candidate: 0, day: 400, pedestrian: true }]);
    const rows = crashesForCandidate(p, 0, base);
    expect(rows.map((c) => c.date)).toEqual(["2024-11-05", "2023-10-02"]);
    expect(rows[0]!.pedestrian).toBe(true);
    expect(rows[1]!.injury).toBe(true);
  });

  it("clamps month arithmetic like dateutil.relativedelta", () => {
    expect(new Date(addMonthsClamped(Date.UTC(2026, 2, 31, 12), -1)).toISOString().slice(0, 10)).toBe("2026-02-28");
    expect(new Date(addMonthsClamped(Date.UTC(2024, 2, 31, 12), -1)).toISOString().slice(0, 10)).toBe("2024-02-29");
    expect(new Date(addMonthsClamped(Date.UTC(2026, 9, 1, 12), -36)).toISOString().slice(0, 10)).toBe("2023-10-01");
  });

  it("never prints NaN/undefined/null and distinguishes 0 from unavailable", () => {
    expect(formatInt(0)).toBe("0");
    expect(formatInt(null)).toBe("Unavailable");
    expect(formatInt(Number.NaN)).toBe("Unavailable");
    expect(formatAadt(null)).toBe("Unavailable");
    expect(formatAadt(27300)).toBe("27,300 vehicles/day");
    expect(formatMiles(290)).toBe("0.18 mi");
    expect(formatScore(null)).toBe("—");
    expect(formatScore(88.5)).toBe("89");
  });
});
