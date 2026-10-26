/**
 * Live journey planning against the real routing service (Valhalla, FOSSGIS) and weather.
 * Opt-in: CROSSMETRIC_LIVE_TESTS=1 npx vitest run test/journey.live.test.ts
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_TRAVEL_PREFERENCES } from "@crossmetric/engine/commute";
import type { JourneyRequest } from "@/lib/journey-types";
import { nearbyTransit } from "@/server/journey/nearby";
import { planJourney } from "@/server/journey/plan";

const live = process.env.CROSSMETRIC_LIVE_TESTS === "1";
const base = (o: Partial<JourneyRequest>): JourneyRequest => ({
  origin: { label: "Cumming", lon: -84.1402, lat: 34.2073 },
  destination: { label: "Five Points", lon: -84.3915, lat: 33.7537 },
  timing: { mode: "now" },
  prefs: { ...DEFAULT_TRAVEL_PREFERENCES, modes: { ...DEFAULT_TRAVEL_PREFERENCES.modes } },
  vehicle: { hasCar: true, permits: [], registered: null, mpg: 28 },
  fuelPrice: 3.1,
  walkSpeedMps: 1.25,
  ...o,
});

describe.skipIf(!live)("live journeys", () => {
  it("Cumming to downtown Atlanta: driving and a drive-to-MARTA option on real roads", { timeout: 90_000 }, async () => {
    const t = Date.now();
    const p = await planJourney(base({}));
    console.log("Cumming → Five Points", Date.now() - t, "ms", p.options.map((o) => `${o.kind} ${o.title} ${o.durationMin}min ${o.distanceM}m [${o.roles.join(",")}]`));
    expect(p.options.some((o) => o.kind === "drive")).toBe(true);
    expect(p.options.find((o) => o.kind === "drive")!.legs[0]!.geometry.length).toBeGreaterThan(10);
  });

  it("step-free walking is routed (pedestrian type wheelchair)", { timeout: 90_000 }, async () => {
    const p = await planJourney(base({ origin: { label: "Midtown", lon: -84.3833, lat: 33.781 }, destination: { label: "Tech Square", lon: -84.3894, lat: 33.7766 }, prefs: { ...DEFAULT_TRAVEL_PREFERENCES, accessible: true, modes: { ...DEFAULT_TRAVEL_PREFERENCES.modes } } }));
    console.log("accessible", p.options.map((o) => `${o.kind} ${o.title} ${o.access} ${o.durationMin}`), p.excluded, p.notes);
    const walk = p.options.find((o) => o.kind === "walk");
    expect(walk?.access).toBe("verified");
    expect(walk!.legs[0]!.geometry.length).toBeGreaterThan(5);
  });

  it("nearest MARTA station from Cumming is a drive away", { timeout: 60_000 }, async () => {
    const r = await nearbyTransit([-84.1402, 34.2073]);
    console.log(r.nearestRail?.station.name, r.nearestRail?.driveMin);
    expect(r.nearestRail?.driveMin).toBeGreaterThan(15);
  });
});
