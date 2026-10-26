/**
 * Live trip tests: real statewide data + the real routing service.
 * Network-dependent, so they only run with CROSSMETRIC_LIVE_TESTS=1:
 *
 *   CROSSMETRIC_LIVE_TESTS=1 npx vitest run test/trips.live.test.ts
 */
import { describe, expect, it } from "vitest";
import type { Place } from "@/lib/trip-types";
import { compareModes, curbOptions, planTrip } from "@/server/trips";

const live = process.env.CROSSMETRIC_LIVE_TESTS === "1";

const MIDTOWN: Place = { label: "Midtown Station", lon: -84.38663, lat: 33.78095, kind: "place" };
const GEORGIA_TECH: Place = { label: "Georgia Institute of Technology", lon: -84.39803, lat: 33.77579, kind: "college", id: "139755" };

describe.skipIf(!live)("trip intelligence (live)", () => {
  it("plans scored walking routes with safest / balanced / fastest roles", async () => {
    const trip = await planTrip(MIDTOWN, GEORGIA_TECH, "walk");
    expect(trip.routes.length).toBeGreaterThanOrEqual(1);
    const roles = trip.routes.flatMap((r) => r.roles).sort();
    expect(roles).toEqual(["balanced", "fastest", "safest"]);
    for (const r of trip.routes) {
      expect(r.crossScore.score).toBeGreaterThanOrEqual(0);
      expect(r.crossScore.score).toBeLessThanOrEqual(100);
      expect(r.geometry.length).toBeGreaterThan(5);
      expect(r.segments.length).toBeGreaterThan(0);
    }
    console.log(
      trip.routes.map((r) => ({
        roles: r.roles,
        strategy: r.strategy,
        min: Math.round(r.durationS / 60),
        km: (r.lengthM / 1000).toFixed(2),
        score: r.crossScore.score,
        confidence: r.crossScore.confidence.level,
        factors: Object.fromEntries(r.crossScore.factors.map((f) => [f.id, `${f.score} (${f.value})`])),
        via: r.via,
        hotspots: r.hotspots.map((h) => `${h.label}: ${h.crashes}`),
      })),
    );
  }, 60_000);

  it("compares modes for the same trip", async () => {
    const modes = await compareModes(MIDTOWN, GEORGIA_TECH);
    console.log(modes.modes.map((m) => `${m.mode}: ${m.available ? `${m.score ?? "-"} ${Math.round((m.durationS ?? 0) / 60)} min` : m.unavailableReason}`));
    expect(modes.modes.find((m) => m.mode === "walk")?.available).toBe(true);
    expect(modes.modes.find((m) => m.mode === "transit")?.nearbyStops?.length).toBeGreaterThan(0);
    expect(modes.modes.some((m) => m.mode === "shuttle")).toBe(true);
  }, 60_000);

  it("compares pickup points around a place", async () => {
    const curb = await curbOptions(MIDTOWN, "pickup");
    console.log(curb.options.map((o) => `${o.current ? "current" : "alt"} ${o.street} ${o.walkM} m -> ${o.score.score} [${o.reasons.join("; ")}]`));
    expect(curb.options.length).toBeGreaterThan(0);
    expect(curb.options[0]!.current).toBe(true);
  }, 60_000);
});
