/**
 * Checks against the real compiled timetables (data/published/commute), when they have been built.
 * Run `python -m pipeline.commute.transit` first; otherwise these tests are skipped.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildDayTimetable, latestDeparture, nearbyStops, reverseTimetable, type TransitNetwork } from "../src/commute/raptor";

const DIR = path.resolve(__dirname, "..", "..", "..", "data", "published", "commute");
const load = (n: string): TransitNetwork | null => {
  const f = path.join(DIR, `transit-${n}.json`);
  return existsSync(f) ? (JSON.parse(readFileSync(f, "utf-8")) as TransitNetwork) : null;
};
const uga = load("uga");
const gt = load("gt");
const H = 3600;

describe.skipIf(!uga)("UGA + ACC network (real GTFS)", () => {
  it("plans from College Station Park & Ride to Tate Center by 9:00 on a weekday", () => {
    const net = uga!;
    const tt = buildDayTimetable(net, "2026-10-13");
    const origin = nearbyStops(net, -83.3632, 33.9351, 400);
    const dest = nearbyStops(net, -83.3746, 33.9506, 400);
    expect(origin.length).toBeGreaterThan(0);
    expect(dest.length).toBeGreaterThan(0);
    const plan = latestDeparture(tt, reverseTimetable(tt), origin, dest, 9 * H);
    expect(plan).not.toBeNull();
    expect(plan!.arrive).toBeLessThanOrEqual(9 * H);
    expect(plan!.leave).toBeGreaterThan(7 * H);
    expect(plan!.leave).toBeLessThan(9 * H);
  });

  it("runs fewer trips on a Saturday than a weekday", () => {
    // The Passio feed has weekday/weekend services only; that is why the app overlays the official service calendar.
    const sat = buildDayTimetable(uga!, "2026-10-24");
    const wk = buildDayTimetable(uga!, "2026-10-13");
    const trips = (tt: typeof wk) => tt.patterns.reduce((n, p) => n + p.trips.filter((t) => t.dayOffset === 0).length, 0);
    expect(trips(sat)).toBeLessThan(trips(wk));
  });
});

describe.skipIf(!gt)("MARTA network (real GTFS)", () => {
  it("plans from Lindbergh Center to Tech Square by 9:30", () => {
    const net = gt!;
    const tt = buildDayTimetable(net, "2026-10-13");
    // Lindbergh Center station area to Georgia Tech's Tech Square.
    const origin = nearbyStops(net, -84.3696, 33.8233, 400);
    const dest = nearbyStops(net, -84.3897, 33.7766, 900);
    const plan = latestDeparture(tt, reverseTimetable(tt), origin, dest, 9.5 * H);
    expect(plan).not.toBeNull();
    expect(plan!.arrive).toBeLessThanOrEqual(9.5 * H);
    expect(9.5 * H - plan!.leave).toBeLessThan(75 * 60);
  });
});
