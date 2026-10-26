/**
 * Cross-language parity: the TypeScript engine (used live in the browser)
 * must reproduce the Python reference implementation (used for validation
 * and PostGIS analyses) exactly, on real published school packages.
 *
 * Fixture: packages/engine/test/fixtures/parity.json
 * Regenerate: python -m pipeline.scoring.parity
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runAnalysis } from "../src/score";
import type { AnalysisConfiguration, ComponentId, SchoolPackage } from "../src/types";

interface Expected {
  id: string;
  priority: number;
  rank: number;
  band: string;
  bestRank: number;
  worstRank: number;
  stability: string;
  scores: Record<ComponentId, number | null>;
}
interface Fixture {
  packages: SchoolPackage[];
  cases: { schoolId: string; config: AnalysisConfiguration; expected: Expected[] }[];
}

const fixture = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/parity.json", import.meta.url)), "utf-8")) as Fixture;
const byId = new Map(fixture.packages.map((p) => [p.school.id, p]));

describe("Python ↔ TypeScript parity on real school packages", () => {
  it("has cases to check", () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(10);
  });

  for (const c of fixture.cases) {
    const label = `${c.schoolId} r=${c.config.radiusM} p=${c.config.periodYears} f=${c.config.crashFilter} s=${c.config.scenario}`;
    it(label, () => {
      const result = runAnalysis(byId.get(c.schoolId)!, c.config);
      expect(result.population).toBe(c.expected.length);
      const got = new Map(result.candidates.map((s) => [s.candidate.id, s]));
      for (const e of c.expected) {
        const s = got.get(e.id);
        expect(s, e.id).toBeDefined();
        expect(s!.priority).toBe(e.priority); // bit-identical floating point
        expect(s!.rank).toBe(e.rank);
        expect(s!.band.id).toBe(e.band);
        expect(s!.sensitivity.stability.bestRank).toBe(e.bestRank);
        expect(s!.sensitivity.stability.worstRank).toBe(e.worstRank);
        expect(s!.sensitivity.stability.level).toBe(e.stability);
        for (const comp of s!.breakdown.components) expect(comp.score, `${e.id} ${comp.id}`).toBe(e.scores[comp.id]);
      }
    });
  }
});
