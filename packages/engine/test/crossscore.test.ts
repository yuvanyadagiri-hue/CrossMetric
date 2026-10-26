import { describe, expect, it } from "vitest";
import {
  CROSSSCORE_MODEL,
  computeCrossScore,
  crashRatioScore,
  crossScoreBand,
  curbReasons,
  referenceShareBelow,
  routeOverlap,
  scoreCurb,
  selectRoutes,
  speedScore,
  validateCrossScoreModel,
  type CrossScoreModel,
  type CurbConditions,
  type DensityReference,
  type RouteConditions,
} from "../src/crossscore";

// Reference: half of mileage has no crashes, then density rises linearly to 10/km.
const levels = Array.from({ length: 201 }, (_, i) => i / 2);
const ramp = levels.map((l) => (l <= 50 ? 0 : ((l - 50) / 50) * 10));
const same = { all: ramp, injury: ramp, pedestrian: ramp, bicyclist: ramp };
// Average crashes per km by setting (per category).
const avg = (all: number, injury: number, pedestrian: number, bicyclist: number) => ({ all, injury, pedestrian, bicyclist });
const REF: DensityReference = {
  levels,
  contexts: {
    quiet: { label: "quieter areas", km: 1, mean: avg(0.5, 0.1, 0.01, 0.01), quantiles: same },
    moderate: { label: "moderately busy areas", km: 1, mean: avg(2, 0.6, 0.05, 0.05), quantiles: same },
    busy: { label: "busy areas", km: 1, mean: avg(5, 1.5, 0.5, 0.25), quantiles: same },
    veryBusy: { label: "very busy areas", km: 1, mean: avg(10, 3, 1, 0.5), quantiles: same },
    urbanCore: { label: "dense urban cores", km: 1, mean: avg(40, 10, 3, 1), quantiles: same },
    freeway: { label: "Georgia interstates and freeways", km: 1, mean: avg(20, 4, 0.1, 0.01), quantiles: same },
  },
};

const none = { all: 0, injury: 0, fatal: 0, pedestrian: 0, bicyclist: 0 };

function route(over: Partial<RouteConditions> = {}): RouteConditions {
  return {
    mode: "walk",
    lengthM: 2000,
    durationS: 1500,
    surfaceM: 2000,
    freewayM: 0,
    crashParts: [{ context: "busy", meters: 2000, counts: { ...none } }],
    lanes: { upTo2M: 2000, threeM: 0, fourOrFiveM: 0, sixPlusM: 0 },
    volume: { localM: 2000, below9000M: 0, below12000M: 0, below15000M: 0, below30000M: 0, atLeast30000M: 0, unknownM: 0 },
    speed: { roadwayM: 2000, taggedM: 2000, mphMeters: 25 * 2000 },
    walkFacilities: { recordedM: 2000, totalM: 2000 },
    bikeFacilities: { separatedM: 0, pathM: 0, dedicatedM: 0, sharedM: 0, noneM: 2000 },
    crossings: { unsignalized: 0, signalized: 0 },
    ...over,
  };
}

describe("CrossScore model file", () => {
  it("is structurally valid and every mode weights known factors", () => {
    expect(() => validateCrossScoreModel(CROSSSCORE_MODEL)).not.toThrow();
    expect(Object.keys(CROSSSCORE_MODEL.modes).sort()).toEqual(["bike", "drive", "walk"]);
  });

  it("rejects a weight for an unknown factor", () => {
    const broken = JSON.parse(JSON.stringify(CROSSSCORE_MODEL)) as CrossScoreModel;
    (broken.modes.walk.weights as Record<string, number>).sunshine = 1;
    expect(() => validateCrossScoreModel(broken)).toThrow(/unknown factor sunshine/);
  });

  it("uses cautious band language", () => {
    expect(crossScoreBand(90).label).toBe("Lower-risk conditions");
    expect(crossScoreBand(75).id).toBe("lower");
    expect(crossScoreBand(74).id).toBe("mixed");
    expect(crossScoreBand(49).id).toBe("higher");
    for (const b of CROSSSCORE_MODEL.bands) expect(b.label.toLowerCase()).not.toMatch(/\bsafe\b|danger/);
  });
});

describe("reference percentiles", () => {
  it("treats zero density as better than every road", () => {
    expect(referenceShareBelow(0, ramp, levels)).toBe(0);
  });
  it("interpolates inside the distribution", () => {
    expect(referenceShareBelow(5, ramp, levels)).toBeCloseTo(0.75, 5);
    expect(referenceShareBelow(10, ramp, levels)).toBeCloseTo(1, 5);
    expect(referenceShareBelow(50, ramp, levels)).toBe(1);
  });
  it("places a tiny positive density just above the zero tie", () => {
    expect(referenceShareBelow(0.0001, ramp, levels)).toBeCloseTo(0.5, 3);
  });
});

describe("speed risk curve (Tefft 2011)", () => {
  it("matches the published points", () => {
    expect(speedScore(23)).toBeCloseTo(90);
    expect(speedScore(32)).toBeCloseTo(75);
    expect(speedScore(42)).toBeCloseTo(50);
    expect(speedScore(58)).toBeCloseTo(10);
    expect(speedScore(70)).toBeCloseTo(10);
  });
});

describe("computeCrossScore", () => {
  it("scores a quiet, sidewalk-lined residential walk highly", () => {
    const r = computeCrossScore(route(), REF);
    expect(r.score).toBeGreaterThanOrEqual(90);
    expect(r.band.id).toBe("lower");
    expect(r.confidence.level).toBe("high");
    expect(r.positives).toContain("No crashes involving a pedestrian recorded along the route");
    expect(r.concerns).toEqual([]);
    const total = r.factors.reduce((s, f) => s + f.contribution, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it("lowers the score for pedestrian crashes, wide fast roads and unsignalized crossings", () => {
    const quiet = computeCrossScore(route(), REF).score;
    const busy = computeCrossScore(
      route({
        crashParts: [{ context: "busy", meters: 2000, counts: { all: 30, injury: 10, fatal: 1, pedestrian: 12, bicyclist: 0 } }],
        lanes: { upTo2M: 500, threeM: 0, fourOrFiveM: 1000, sixPlusM: 500 },
        volume: { localM: 500, below9000M: 0, below12000M: 0, below15000M: 0, below30000M: 1500, atLeast30000M: 0, unknownM: 0 },
        speed: { roadwayM: 2000, taggedM: 1500, mphMeters: 45 * 1500 },
        walkFacilities: { recordedM: 400, totalM: 2000 },
        crossings: { unsignalized: 2, signalized: 1 },
      }),
      REF,
    );
    expect(busy.score).toBeLessThan(quiet - 30);
    expect(busy.band.id).toBe("higher");
    expect(busy.concerns.join(" ")).toMatch(/pedestrian/i);
    expect(busy.concerns.join(" ")).toMatch(/without a traffic signal record/);
    expect(busy.factors.find((f) => f.id === "crossings")!.score).toBe(100 - 2 * 15 - 6);
  });

  it("excludes unavailable factors and reweights instead of treating them as zero", () => {
    const r = computeCrossScore(route({ speed: { roadwayM: 2000, taggedM: 100, mphMeters: 100 * 30 }, walkFacilities: null }), REF);
    const speed = r.factors.find((f) => f.id === "roadSpeed")!;
    expect(speed.score).toBeNull();
    expect(speed.contribution).toBe(0);
    expect(r.confidence.missing).toEqual(["roadSpeed", "sidewalks"]);
    expect(r.confidence.level).toBe("moderate");
    expect(r.score).toBeGreaterThanOrEqual(90);
  });

  it("compares freeway mileage with freeway roads when driving", () => {
    const drive = route({
      mode: "drive",
      surfaceM: 1000,
      freewayM: 4000,
      crashParts: [
        { context: "busy", meters: 1000, counts: { ...none } },
        { context: "freeway", meters: 4000, counts: { all: 40, injury: 2, fatal: 0, pedestrian: 0, bicyclist: 0 } },
      ],
    });
    const r = computeCrossScore(drive, REF);
    const crash = r.factors.find((f) => f.id === "crashHistory")!;
    // 40 crashes where 4 km of freeway (20/km) + 1 km of busy street (5/km) would average 85.
    expect(crash.score).toBe(Math.floor(crashRatioScore(40 / 85) + 0.5));
    expect(crash.detail).toMatch(/Georgia roads of the same type/);
    expect(r.factors.map((f) => f.id)).toEqual(["crashHistory", "severeCrashes", "crossings"]);
  });

  it("compares each stretch with the average for streets in the same setting", () => {
    const counts = { all: 10, injury: 0, fatal: 0, pedestrian: 2, bicyclist: 0 };
    const busy = computeCrossScore(route({ crashParts: [{ context: "busy", meters: 2000, counts }] }), REF);
    const veryBusy = computeCrossScore(route({ crashParts: [{ context: "veryBusy", meters: 2000, counts }] }), REF);
    const ped = (r: typeof busy) => r.factors.find((f) => f.id === "pedestrianCrashes")!;
    // 2 crashes over 2 km: twice the busy-area average (1 expected), exactly the very-busy average (2 expected).
    expect(ped(busy).score).toBe(Math.floor(crashRatioScore(2) + 0.5));
    expect(ped(veryBusy).score).toBe(70);
    expect(ped(veryBusy).detail).toMatch(/about the average for streets in very busy areas/);
    expect(ped(busy).detail).toMatch(/2\.0× the average for streets in busy areas/);
  });

  it("maps the crash ratio onto a smooth, bounded scale", () => {
    expect(crashRatioScore(0)).toBe(100);
    expect(crashRatioScore(1)).toBeCloseTo(70, 6);
    expect(crashRatioScore(2)).toBeCloseTo(53.85, 2);
    expect(crashRatioScore(4)).toBeCloseTo(36.84, 2);
    expect(crashRatioScore(0.5)).toBeCloseTo(82.35, 2);
  });

  it("is deterministic", () => {
    const a = computeCrossScore(route({ crossings: { unsignalized: 1, signalized: 0 } }), REF);
    const b = computeCrossScore(route({ crossings: { unsignalized: 1, signalized: 0 } }), REF);
    expect(a).toEqual(b);
  });
});

describe("selectRoutes", () => {
  it("picks safest within a practical time limit, balanced with a time penalty, and fastest", () => {
    const sel = selectRoutes([
      { id: "fast", durationS: 1000, score: 60 },
      { id: "mid", durationS: 1150, score: 80 },
      { id: "slow", durationS: 1550, score: 88 },
      { id: "tooSlow", durationS: 2000, score: 99 },
    ]);
    expect(sel.roles).toEqual({ safest: "slow", balanced: "mid", fastest: "fast" });
    expect(sel.options.map((o) => o.id)).toEqual(["slow", "mid", "fast"]);
  });

  it("merges roles when one route is best on several", () => {
    const sel = selectRoutes([
      { id: "a", durationS: 600, score: 90 },
      { id: "b", durationS: 700, score: 70 },
    ]);
    expect(sel.options).toEqual([{ id: "a", roles: ["safest", "balanced", "fastest"] }]);
  });
});

describe("safer pickup", () => {
  const curb = (over: Partial<CurbConditions>): CurbConditions => ({
    id: "x",
    walkM: 0,
    context: "busy",
    crashes: { ...none },
    lanes: null,
    aadt: null,
    speedMph: null,
    localStreet: true,
    ...over,
  });

  it("prefers a quiet local curb to a busy arterial curb and explains why", () => {
    const current = curb({ id: "cur", lanes: 5, aadt: 32000, speedMph: 45, localStreet: false, crashes: { all: 12, injury: 3, fatal: 0, pedestrian: 2, bicyclist: 0 } });
    const alt = curb({ id: "alt", walkM: 55, speedMph: 25 });
    const a = scoreCurb(current, REF);
    const b = scoreCurb(alt, REF);
    expect(b.score).toBeGreaterThan(a.score + 30);
    const reasons = curbReasons(current, alt);
    expect(reasons).toContain("Lower posted speed (25 vs 45 mph)");
    expect(reasons).toContain("Fewer lanes (2 vs 5)");
    expect(reasons).toContain("On a local street instead of a major road");
    expect(reasons).toContain("Fewer pedestrian crashes nearby");
  });
});

describe("routeOverlap", () => {
  it("is 1 for identical paths and 0 for disjoint ones", () => {
    const a: [number, number][] = Array.from({ length: 50 }, (_, i) => [-84.39 + i * 0.0002, 33.77]);
    const b: [number, number][] = a.map(([x, y]) => [x, y + 0.01]);
    expect(routeOverlap(a, a)).toBe(1);
    expect(routeOverlap(a, b)).toBe(0);
  });
});
