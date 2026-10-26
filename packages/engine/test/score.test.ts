import { describe, expect, it } from "vitest";
import { bandFor, MODEL, validateModel } from "../src/model";
import { runAnalysis } from "../src/score";
import type { AnalysisConfiguration, ScoringModel } from "../src/types";
import { candidate, many, pkg } from "./fixtures";

const base: AnalysisConfiguration = { radiusM: 800, periodYears: 3, crashFilter: "all", scenario: "standard" };

describe("model file", () => {
  it("is structurally valid", () => {
    expect(() => validateModel(MODEL)).not.toThrow();
    expect(MODEL.components.map((c) => c.id)).toEqual(["crash", "injury", "pedestrian", "traffic", "proximity"]);
  });

  it("rejects a scenario missing a weight", () => {
    const broken = JSON.parse(JSON.stringify(MODEL)) as ScoringModel;
    delete (broken.scenarios[0]!.weights as Partial<Record<string, number>>).traffic;
    expect(() => validateModel(broken)).toThrow(/weight for traffic/);
  });

  it("maps scores to cautious priority bands", () => {
    expect(bandFor(100).id).toBe("high");
    expect(bandFor(80).id).toBe("high");
    expect(bandFor(79).id).toBe("elevated");
    expect(bandFor(60).id).toBe("elevated");
    expect(bandFor(59).id).toBe("moderate");
    expect(bandFor(40).id).toBe("moderate");
    expect(bandFor(39).id).toBe("lower");
    expect(bandFor(0).id).toBe("lower");
    expect(bandFor(80).label).toBe("High Priority for Review");
  });
});

describe("runAnalysis", () => {
  it("combines equal-weight component percentiles (Standard scenario)", () => {
    // Two candidates. A: 4 crashes (2 injury, 1 ped), 20,000 AADT, 100 m.
    //                 B: 1 crash, 10,000 AADT, 300 m.
    const p = pkg(
      [
        candidate("A", { distanceM: 100, traffic: { aadt: 20000, year: 2023, status: "measured", roadsCounted: 2, roadsTotal: 2 } }),
        candidate("B", { distanceM: 300, traffic: { aadt: 10000, year: 2023, status: "measured", roadsCounted: 2, roadsTotal: 2 } }),
      ],
      [...many(0, 1, { injury: true, pedestrian: true }), ...many(0, 1, { injury: true }), ...many(0, 2), ...many(1, 1)],
    );
    const r = runAnalysis(p, base);
    const a = r.candidates.find((c) => c.candidate.id === "A")!;
    const b = r.candidates.find((c) => c.candidate.id === "B")!;
    // A: crash 100, injury 100, ped 100, traffic 100, proximity 100 -> 100
    expect(a.priority).toBe(100);
    // B: crash 50, injury 0 (zero evidence), ped 0, traffic 50, proximity 50 -> 150 / 5 = 30
    expect(b.priority).toBe(30);
    expect(a.rank).toBe(1);
    expect(b.rank).toBe(2);
    expect(a.band.id).toBe("high");
    expect(b.band.id).toBe("lower");
  });

  it("excludes missing AADT and rescales the remaining weights (never treats it as zero)", () => {
    const p = pkg(
      [
        candidate("A", { distanceM: 100, traffic: { aadt: null, year: null, status: "unavailable", roadsCounted: 0, roadsTotal: 2 } }),
        candidate("B", { distanceM: 300 }),
      ],
      [...many(0, 3, { injury: true, pedestrian: true }), ...many(1, 1)],
    );
    const a = runAnalysis(p, base).candidates.find((c) => c.candidate.id === "A")!;
    expect(a.breakdown.excluded).toEqual(["traffic"]);
    expect(a.breakdown.weightUsed).toBe(4);
    const traffic = a.breakdown.components.find((c) => c.id === "traffic")!;
    expect(traffic.score).toBeNull();
    expect(traffic.rawValue).toBeNull();
    // remaining four components are all 100 -> priority 100, not 80
    expect(a.priority).toBe(100);
  });

  it("applies the radius: only candidates inside it form the population", () => {
    const p = pkg([candidate("near", { distanceM: 350 }), candidate("mid", { distanceM: 700 }), candidate("far", { distanceM: 1100 })]);
    expect(runAnalysis(p, { ...base, radiusM: 400 }).population).toBe(1);
    expect(runAnalysis(p, { ...base, radiusM: 800 }).population).toBe(2);
    expect(runAnalysis(p, { ...base, radiusM: 1200 }).population).toBe(3);
  });

  it("applies the crash filter to every evidence component", () => {
    const p = pkg([candidate("A"), candidate("B", { distanceM: 200 })], [...many(0, 5), ...many(1, 1, { pedestrian: true })]);
    const all = runAnalysis(p, base);
    const ped = runAnalysis(p, { ...base, crashFilter: "pedestrian" });
    expect(all.candidates[0]!.candidate.id).toBe("A");
    expect(ped.candidates.find((c) => c.candidate.id === "A")!.features.crashes).toBe(0);
    expect(ped.candidates[0]!.candidate.id).toBe("B");
    expect(ped.matchedCrashes).toBe(1);
  });

  it("applies the analysis period", () => {
    // day 0 = 2023-10-02. 12-month period starts 2025-10-02 = day 731.
    const p = pkg([candidate("A")], [{ candidate: 0, day: 10 }, { candidate: 0, day: 731 }, { candidate: 0, day: 1000 }]);
    expect(runAnalysis(p, { ...base, periodYears: 3 }).candidates[0]!.features.crashes).toBe(3);
    expect(runAnalysis(p, { ...base, periodYears: 1 }).candidates[0]!.features.crashes).toBe(2);
    expect(runAnalysis(p, { ...base, periodYears: 1 }).periodWindow).toEqual({ start: "2025-10-02", end: "2026-10-01" });
  });

  it("changes ranking when the scenario changes", () => {
    // A: many crashes, no pedestrian. B: fewer crashes, two pedestrian.
    const p = pkg(
      [candidate("A", { distanceM: 150 }), candidate("B", { distanceM: 150 }), candidate("C", { distanceM: 600 })],
      [...many(0, 6, { injury: true }), ...many(1, 2, { pedestrian: true }), ...many(2, 1)],
    );
    const std = runAnalysis(p, base);
    const pedEmphasis = runAnalysis(p, { ...base, scenario: "pedestrian" });
    const crashEmphasis = runAnalysis(p, { ...base, scenario: "crash" });
    const rankOf = (r: typeof std, id: string) => r.candidates.find((c) => c.candidate.id === id)!.rank;
    expect(rankOf(crashEmphasis, "A")).toBe(1);
    expect(rankOf(pedEmphasis, "B")).toBeLessThanOrEqual(rankOf(std, "B"));
    // each candidate carries its rank under every scenario
    const a = std.candidates.find((c) => c.candidate.id === "A")!;
    expect(Object.keys(a.sensitivity.ranks).sort()).toEqual(["crash", "injury", "pedestrian", "standard"]);
  });

  it("breaks exact ties by crashes, then distance, then id — deterministically", () => {
    const p = pkg([candidate("b", { distanceM: 200 }), candidate("a", { distanceM: 200 }), candidate("c", { distanceM: 100 })]);
    // No crashes anywhere; c is nearest so it leads; a and b tie fully and fall back to id order.
    const order = runAnalysis(p, base).candidates.map((c) => c.candidate.id);
    expect(order).toEqual(["c", "a", "b"]);
    expect(runAnalysis(p, base).candidates.map((c) => c.candidate.id)).toEqual(order);
  });

  it("reports contributions that sum to 1 when priority > 0", () => {
    const p = pkg([candidate("A"), candidate("B", { distanceM: 500 })], [...many(0, 2, { injury: true }), ...many(1, 1)]);
    for (const s of runAnalysis(p, base).candidates) {
      const total = s.breakdown.components.reduce((acc, c) => acc + c.contribution, 0);
      if (s.priority > 0) expect(total).toBeCloseTo(1, 10);
    }
  });

  it("handles an empty analysis without NaN", () => {
    const r = runAnalysis(pkg([candidate("far", { distanceM: 1150 })]), { ...base, radiusM: 400 });
    expect(r.population).toBe(0);
    expect(r.candidates).toEqual([]);
    expect(r.matchedCrashes).toBe(0);
  });
});
