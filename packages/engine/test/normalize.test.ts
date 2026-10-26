import { describe, expect, it } from "vitest";
import { ordinal, percentileScores, roundHalfUp } from "../src/normalize";

describe("percentileScores", () => {
  it("computes the empirical CDF: share of values <= v", () => {
    expect(percentileScores([10, 20, 30, 40], { lowerIsPriority: false, evidence: false })).toEqual([25, 50, 75, 100]);
  });

  it("gives tied values the same (upper) percentile", () => {
    expect(percentileScores([5, 5, 9, 1], { lowerIsPriority: false, evidence: false })).toEqual([75, 75, 100, 25]);
  });

  it("flips the comparison for lower-is-priority measures (distance)", () => {
    // nearest (100 m) is the highest priority
    expect(percentileScores([100, 200, 300, 400], { lowerIsPriority: true, evidence: false })).toEqual([100, 75, 50, 25]);
  });

  it("scores zero evidence as 0 instead of the percentile of the tie at zero", () => {
    const scores = percentileScores([0, 0, 0, 2, 5], { lowerIsPriority: false, evidence: true });
    expect(scores).toEqual([0, 0, 0, 80, 100]);
  });

  it("keeps unavailable values unavailable (null) and excludes them from N", () => {
    const scores = percentileScores([null, 1000, 3000], { lowerIsPriority: false, evidence: false });
    expect(scores).toEqual([null, 50, 100]);
  });

  it("returns all null when nothing is available", () => {
    expect(percentileScores([null, null], { lowerIsPriority: false, evidence: false })).toEqual([null, null]);
  });

  it("never produces NaN for a single candidate", () => {
    expect(percentileScores([7], { lowerIsPriority: false, evidence: true })).toEqual([100]);
  });
});

describe("ordinal and rounding", () => {
  it("formats ordinals including the teens", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 95, 100, 111].map(ordinal)).toEqual([
      "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "95th", "100th", "111th",
    ]);
  });

  it("rounds half up like JavaScript Math.round and the Python reference", () => {
    expect(roundHalfUp(79.5)).toBe(80);
    expect(roundHalfUp(79.49)).toBe(79);
    expect(roundHalfUp(0.5)).toBe(1);
  });
});
