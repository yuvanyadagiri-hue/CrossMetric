import { describe, expect, it } from "vitest";
import { buildDayTimetable, earliestArrival, latestDeparture, reverseTimetable, rideGeometry, serviceActive, type TransitNetwork } from "../src/commute/raptor";
import { serviceDayStart, zonedToUtc } from "../src/commute/time";

const H = 3600;
const M = 60;

/**
 * Stops: 0 Origin stop, 1 Hub A, 2 Hub B (120 m from Hub A), 3 Campus stop, 4 Night stop.
 * Route X: 0 -> 1, 10 minutes, every 20 min from 07:00 to 09:00.
 * Route Y: 2 -> 3, 8 minutes, departures 07:25, 07:45, 08:05, 08:25 (exact).
 * Route Z: 0 -> 3 direct, one trip at 07:40 taking 30 minutes.
 * Route N: 3 -> 4 night trip starting 24:30 on the previous service day.
 */
function network(): TransitNetwork {
  const prof = (legs: number[]) => {
    const out = [0, 0];
    let t = 0;
    for (const l of legs) {
      t += l;
      out.push(t, t);
    }
    return out;
  };
  const weekday = { id: "f:wk", days: [1, 1, 1, 1, 1, 0, 0], start: "20260101", end: "20261231", added: [], removed: ["20261126"] };
  const trips = (starts: number[], headway = 0) => starts.map((s) => [s, 0, 0, headway] as [number, number, number, number]);
  return {
    network: "test",
    generatedAt: "",
    feeds: [],
    stops: { id: ["s0", "s1", "s2", "s3", "s4"], name: ["Origin", "Hub A", "Hub B", "Campus", "Night"], lon: [0, 0.01, 0.0113, 0.03, 0.04], lat: [0, 0, 0, 0, 0], feed: ["f", "f", "f", "f", "f"] },
    routes: ["X", "Y", "Z", "N"].map((r) => ({ id: `f:${r}`, feed: "f", short: r, long: r, color: "#000", text: "#fff", type: 3 })),
    services: [weekday],
    patterns: [
      { route: 0, stops: [0, 1], headsign: "Hub", profiles: [prof([10 * M])], trips: trips([7 * H, 7 * H + 20 * M, 7 * H + 40 * M, 8 * H, 8 * H + 20 * M, 8 * H + 40 * M], 20 * M), shape: [], stopDist: [] },
      { route: 1, stops: [2, 3], headsign: "Campus", profiles: [prof([8 * M])], trips: trips([7 * H + 25 * M, 7 * H + 45 * M, 8 * H + 5 * M, 8 * H + 25 * M]), shape: [], stopDist: [] },
      { route: 2, stops: [0, 3], headsign: "Campus", profiles: [prof([30 * M])], trips: trips([7 * H + 40 * M]), shape: [], stopDist: [] },
      { route: 3, stops: [3, 4], headsign: "Night", profiles: [prof([10 * M])], trips: trips([24 * H + 30 * M]), shape: [], stopDist: [] },
    ],
    footpaths: [
      [1, 2, 120],
      [2, 1, 120],
    ],
  };
}

const opts = { walkSpeedMps: 1.2, detourFactor: 1 };

describe("RAPTOR transit search", () => {
  it("applies calendar weekdays and removed dates", () => {
    const svc = network().services[0]!;
    expect(serviceActive(svc, "2026-10-13")).toBe(true); // Tuesday
    expect(serviceActive(svc, "2026-10-17")).toBe(false); // Saturday
    expect(serviceActive(svc, "2026-11-26")).toBe(false); // removed (Thanksgiving)
  });

  it("finds the latest departure that still makes an 8:15 deadline, through a walking transfer", () => {
    const tt = buildDayTimetable(network(), "2026-10-13", opts);
    const rev = reverseTimetable(tt);
    const plan = latestDeparture(tt, rev, [{ stop: 0, seconds: 5 * M }], [{ stop: 3, seconds: 2 * M }], 8 * H + 15 * M, { maxRides: 3, boardSlack: 60, alightSlack: 0 });
    expect(plan).not.toBeNull();
    // Y 08:05 arrives 08:13 (+2 walk = 08:15). To catch it: X 07:40 reaches Hub A 07:50, walk 100 s to Hub B.
    // The direct Z (07:40, arrives 08:10) would need leaving at 07:34; X 07:40 needs leaving at 07:34 too, but fewer rides wins.
    expect(plan!.leave).toBe(7 * H + 40 * M - 60 - 5 * M);
    expect(plan!.rides).toBe(1);
    expect(plan!.arrive).toBeLessThanOrEqual(8 * H + 15 * M);
  });

  it("uses the transfer itinerary when the direct trip is gone", () => {
    const net = network();
    net.patterns[2]!.trips = [];
    const tt = buildDayTimetable(net, "2026-10-13", opts);
    const plan = latestDeparture(tt, reverseTimetable(tt), [{ stop: 0, seconds: 5 * M }], [{ stop: 3, seconds: 2 * M }], 8 * H + 15 * M, { maxRides: 3, boardSlack: 60, alightSlack: 0 });
    expect(plan!.rides).toBe(2);
    expect(plan!.legs.map((l) => l.kind)).toEqual(["ride", "walk", "ride"]);
    expect(plan!.leave).toBe(7 * H + 40 * M - 60 - 5 * M);
    expect(plan!.arrive).toBe(8 * H + 13 * M + 2 * M);
  });

  it("never boards a bus that left before the rider reaches the stop", () => {
    const tt = buildDayTimetable(network(), "2026-10-13", opts);
    // Leaving at 07:36 reaches stop 0 at 07:41: the 07:40 X and Z have gone; next X is 08:00.
    const plan = earliestArrival(tt, [{ stop: 0, seconds: 5 * M }], [{ stop: 3, seconds: 2 * M }], 7 * H + 36 * M);
    expect(plan!.legs[0]).toMatchObject({ kind: "ride", depart: 8 * H });
    // 08:00 X -> 08:10 Hub A -> walk -> 08:25 Y -> 08:33 + 2 min walk.
    expect(plan!.arrive).toBe(8 * H + 35 * M);
  });

  it("returns null when nothing arrives in time within the planning horizon", () => {
    const tt = buildDayTimetable(network(), "2026-10-13", opts);
    expect(latestDeparture(tt, reverseTimetable(tt), [{ stop: 0, seconds: 0 }], [{ stop: 3, seconds: 0 }], 7 * H + 20 * M)).toBeNull();
  });

  it("keeps trips past midnight on the day they started", () => {
    // Wednesday 00:30 is Tuesday's 24:30 trip.
    const tt = buildDayTimetable(network(), "2026-10-14", opts);
    const plan = earliestArrival(tt, [{ stop: 3, seconds: 0 }], [{ stop: 4, seconds: 0 }], 0);
    expect(plan!.legs[0]).toMatchObject({ kind: "ride", depart: 30 * M, dayOffset: -1 });
    // Sunday has no 00:30 trip (Saturday has no service); the next one is Monday's, at 48:30 on Sunday's axis.
    const sun = buildDayTimetable(network(), "2026-10-18", opts);
    expect(earliestArrival(sun, [{ stop: 3, seconds: 0 }], [{ stop: 4, seconds: 0 }], 0)!.legs[0]).toMatchObject({ depart: 48 * H + 30 * M, dayOffset: 1 });
  });

  it("places the timetable axis on the GTFS service-day reference", () => {
    const tt = buildDayTimetable(network(), "2026-10-13", opts);
    expect(tt.ref).toBe(serviceDayStart("2026-10-13"));
    expect(tt.ref + 8 * H * 1000).toBe(zonedToUtc("2026-10-13", 8 * 60));
  });

  it("falls back to stop-to-stop geometry without a shape", () => {
    expect(rideGeometry(network(), 0, 0, 1)).toEqual([
      [0, 0],
      [0.01, 0],
    ]);
  });
});
