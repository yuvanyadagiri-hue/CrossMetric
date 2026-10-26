import { describe, expect, it } from "vitest";
import { zonedToUtc } from "@crossmetric/engine/commute";
import { fitPadding, FLICK_SPEED, releaseVelocity, settleSnap } from "@/components/commute/motion";
import { journeySegments, leavesIn, optionFacts } from "@/components/commute/journey-ui";
import type { PlanLeg } from "@/lib/commute-types";
import type { JourneyOption, JourneyPlace } from "@/lib/journey-types";
import { canShareStart, decodeSharedPlace, encodeSharedPlace, readSharedTrip, shareTripUrl } from "@/lib/share";

const MIN = 60_000;
const at = (date: string, time: string) => {
  const [h, m] = time.split(":").map(Number);
  return zonedToUtc(date, h! * 60 + m!);
};
const NOW = at("2026-10-15", "19:30");

describe("the sheet settles where a person expects", () => {
  const points: [string, number][] = [
    ["rest", 300],
    ["half", 420],
    ["full", 700],
  ];

  it("a slow release goes to the nearest size", () => {
    expect(settleSnap(330, 0, points)).toBe("rest");
    expect(settleSnap(400, 0, points)).toBe("half");
    expect(settleSnap(600, 0, points)).toBe("full");
  });

  it("a flick moves one size in its direction, even from near the current one", () => {
    expect(settleSnap(310, FLICK_SPEED + 0.1, points)).toBe("half");
    expect(settleSnap(430, FLICK_SPEED + 0.1, points)).toBe("full");
    expect(settleSnap(690, -(FLICK_SPEED + 0.1), points)).toBe("half");
    expect(settleSnap(410, -(FLICK_SPEED + 0.1), points)).toBe("rest");
  });

  it("a flick past the ends stays at the end", () => {
    expect(settleSnap(720, 2, points)).toBe("full");
    expect(settleSnap(250, -2, points)).toBe("rest");
  });

  it("release speed is measured over the last ~100 ms", () => {
    const samples = [
      { t: 0, h: 300 },
      { t: 50, h: 300 },
      { t: 200, h: 320 },
      { t: 300, h: 380 },
    ];
    expect(releaseVelocity(samples)).toBeCloseTo(0.6, 5);
    expect(releaseVelocity([{ t: 0, h: 1 }])).toBe(0);
  });
});

describe("the map always has room to frame a route", () => {
  it("keeps the requested padding when it fits", () => {
    expect(fitPadding({ top: 100, bottom: 300, left: 24, right: 88 }, 390, 844)).toEqual({ top: 100, bottom: 300, left: 24, right: 88 });
  });

  it("shrinks padding proportionally when the sheet covers most of the screen", () => {
    const p = fitPadding({ top: 100, bottom: 760, left: 24, right: 88 }, 390, 844, 96);
    expect(844 - p.top - p.bottom).toBeGreaterThanOrEqual(96);
    expect(p.bottom / p.top).toBeCloseTo(7.6, 0);
  });
});

const walk = (minutes: number, extra: Partial<PlanLeg> = {}): PlanLeg => ({ kind: "walk", from: "A", to: "B", minutes, meters: minutes * 80, depart: null, arrive: null, geometry: [], ...extra }) as PlanLeg;
const ride = (minutes: number, short: string, color = "#DA291C"): PlanLeg => ({ kind: "ride", from: "Stop", to: "Stop 2", minutes, depart: null, arrive: null, geometry: [], route: { short, long: "", agency: "MARTA", color, text: "#FFFFFF" } }) as unknown as PlanLeg;
const drive = (minutes: number): PlanLeg => ({ kind: "drive", from: "A", to: "B", minutes, meters: 3000, depart: null, arrive: null, geometry: [] }) as PlanLeg;

describe("the journey bar shows what a person does, in proportion", () => {
  it("keeps waits, names lines, and drops parking steps and sub-minute walks", () => {
    const legs = [walk(8), { kind: "wait", from: "Stop", to: "Stop", minutes: 6, depart: null, arrive: null, geometry: [] } as unknown as PlanLeg, ride(12, "RED"), walk(0.4), { kind: "park", from: "Deck", to: "Deck", minutes: 0, depart: null, arrive: null, geometry: [] } as unknown as PlanLeg, walk(3)];
    const segs = journeySegments(legs);
    expect(segs.map((s) => s.kind)).toEqual(["walk", "wait", "ride", "walk"]);
    expect(segs[2]).toMatchObject({ short: "Red", color: "#DA291C" });
    expect(segs.map((s) => s.label)).toEqual(["Walk 8 min", "Wait 6 min", "Red line 12 min", "Walk 3 min"]);
  });

  it("draws the stated planning buffer after the drive, so the bar adds up to the card's time", () => {
    const segs = journeySegments([drive(7), walk(2)], { durationMin: 14, bufferMin: 5 });
    expect(segs.map((s) => [s.kind, s.minutes])).toEqual([
      ["drive", 7],
      ["buffer", 5],
      ["walk", 2],
    ]);
    expect(segs[1]!.label).toBe("Planning buffer 5 min");
  });

  it("adds nothing when the legs already account for the whole time", () => {
    expect(journeySegments([walk(30)], { durationMin: 30, bufferMin: 0 }).map((s) => s.kind)).toEqual(["walk"]);
  });
});

describe("cards say only what applies to the option", () => {
  const base = { costUsd: 2.5, walkMin: 10, kind: "transit", transfers: 0, distanceM: 4667 } as unknown as JourneyOption;
  it("transit lists fare, walking, transfers and distance", () => {
    expect(optionFacts(base)).toEqual(["$2.50", "10 min walking", "No transfers", "2.9 mi"]);
  });
  it("an unknown cost is said, never shown as free", () => {
    expect(optionFacts({ ...base, kind: "drive", costUsd: null, walkMin: 0 })).toEqual(["Cost unknown", "2.9 mi"]);
    expect(optionFacts({ ...base, kind: "walk", costUsd: 0, walkMin: 52 })[0]).toBe("Free");
  });
  it("counts down to a timed departure and stops at zero", () => {
    expect(leavesIn(NOW + 6 * MIN + 10_000, NOW)).toBe("in 6 min");
    expect(leavesIn(NOW + 65 * MIN, NOW)).toBe("in 1 hr 5 min");
    expect(leavesIn(NOW + 20_000, NOW)).toBeNull();
    expect(leavesIn(NOW - MIN, NOW)).toBeNull();
  });
});

describe("share links carry only what the person chose", () => {
  const ponce: JourneyPlace = { label: "Ponce City Market", sublabel: "Atlanta, GA", lon: -84.36532, lat: 33.77231, source: "place" };
  const home: JourneyPlace = { label: "123 Example St NE, Atlanta", lon: -84.35, lat: 33.79, source: "saved" };
  const here: JourneyPlace = { label: "Current location", lon: -84.39, lat: 33.77, source: "current" };
  const klaus: JourneyPlace = { label: "Klaus Advanced Computing Building", lon: -84.3963, lat: 33.7771, source: "building", campus: "gt", buildingId: "w123456" };

  it("never writes the current location, and includes a start only when asked", () => {
    expect(encodeSharedPlace(here)).toBeNull();
    expect(canShareStart(here)).toBe(false);
    const withoutStart = shareTripUrl("https://example.org", { origin: home, destination: ponce, timing: { mode: "now" }, includeStart: false })!;
    expect(new URL(withoutStart).searchParams.has("from")).toBe(false);
    const withStart = shareTripUrl("https://example.org", { origin: home, destination: ponce, timing: { mode: "now" }, includeStart: true })!;
    expect(decodeSharedPlace(new URL(withStart).searchParams.get("from"))).toMatchObject({ label: home.label, source: "place" });
    const fromHere = shareTripUrl("https://example.org", { origin: here, destination: ponce, timing: { mode: "now" }, includeStart: true })!;
    expect(new URL(fromHere).searchParams.has("from")).toBe(false);
  });

  it("round-trips places, labels with commas and campus buildings", () => {
    const comma = { ...ponce, label: "Ponce City Market, Atlanta" };
    expect(decodeSharedPlace(encodeSharedPlace(comma))).toMatchObject({ label: "Ponce City Market, Atlanta", lon: -84.36532, lat: 33.77231 });
    expect(decodeSharedPlace(encodeSharedPlace(klaus))).toMatchObject({ campus: "gt", buildingId: "w123456", source: "building" });
  });

  it("rejects places outside Georgia and malformed values", () => {
    expect(decodeSharedPlace("-122.4,37.7,place,,,San Francisco")).toBeNull();
    expect(decodeSharedPlace("abc")).toBeNull();
    expect(decodeSharedPlace(null)).toBeNull();
    expect(decodeSharedPlace(`-84.36,33.77,script,,,${"x".repeat(500)}`)).toBeNull();
    expect(decodeSharedPlace("-84.36,33.77,<b>,zz,../../x,Ponce\u0007")).toMatchObject({ source: "place", label: "Ponce" });
    expect(decodeSharedPlace("-84.36,33.77,<b>,zz,../../x,Ponce")!.buildingId).toBeUndefined();
  });

  it("a shared future time is kept; a passed one opens as Leave now and says so", () => {
    const future = new URL(shareTripUrl("https://example.org", { origin: null, destination: ponce, timing: { mode: "arrive", by: NOW + 90 * MIN }, includeStart: false })!).searchParams;
    expect(readSharedTrip(future, NOW)).toMatchObject({ timing: { mode: "arrive", by: NOW + 90 * MIN }, timingDropped: false, origin: null });
    expect(readSharedTrip(future, NOW + 3 * 3600_000)).toMatchObject({ timing: { mode: "now" }, timingDropped: true });
    const now = new URL(shareTripUrl("https://example.org", { origin: null, destination: ponce, timing: { mode: "now" }, includeStart: false })!).searchParams;
    expect(readSharedTrip(now, NOW)).toMatchObject({ timing: { mode: "now" }, timingDropped: false });
    expect(readSharedTrip(new URLSearchParams("to=nonsense"), NOW)).toBeNull();
  });
});
