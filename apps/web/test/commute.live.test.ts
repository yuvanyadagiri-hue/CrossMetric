/**
 * End-to-end planner checks against the live routing (Valhalla) and weather (NWS) services.
 * Opt in with CROSSMETRIC_LIVE_TESTS=1; skipped otherwise so CI never depends on them.
 */
import { describe, expect, it } from "vitest";
import { addDays, localDate, zonedToUtc } from "@crossmetric/engine/commute";
import type { PlanRequest } from "@/lib/commute-types";
import { planCommute } from "@/server/commute/plan";

const live = process.env.CROSSMETRIC_LIVE_TESTS === "1";
const KLAUS = "w42706123";
const MLC = "w598413270";

/** Next weekday (Tue-Thu) at least a day ahead, so plans are always in the future. */
function nextWeekday(): string {
  let d = addDays(localDate(Date.now()), 1);
  for (let i = 0; i < 7; i++) {
    const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (wd >= 2 && wd <= 4) return d;
    d = addDays(d, 1);
  }
  return d;
}

const base = (p: Partial<PlanRequest>): PlanRequest => ({
  campus: "gt",
  origin: { lon: -84.3696, lat: 33.8233, label: "Lindbergh" },
  buildingId: KLAUS,
  deadline: 0,
  parkUntil: null,
  vehicle: { permits: [], registered: null, hasCar: true, mpg: 30 },
  fuelPrice: 3,
  walkSpeedMps: 1.25,
  modes: ["walk", "drive", "transit", "park_ride"],
  ...p,
});

describe.skipIf(!live)("live commute planning", () => {
  const day = nextWeekday();

  it("GT: arrive-by plan with a legal paid deck and a MARTA alternative", async () => {
    const deadline = zonedToUtc(day, 9 * 60 + 25);
    const plan = await planCommute(base({ deadline, parkUntil: zonedToUtc(day, 11 * 60) }), Date.now());
    const all = [plan.recommended, ...plan.alternatives].filter(Boolean);
    expect(all.length).toBeGreaterThan(0);
    for (const o of all) {
      expect(o!.arriveAt!).toBeLessThanOrEqual(deadline + 60_000);
      if (o!.parking) expect(["allowed", "requires_action"]).toContain(o!.parking.status);
    }
    expect(all.some((o) => o!.kind === "transit")).toBe(true);
    // No invented connection: every ride is MARTA on the GT network.
    for (const o of all) for (const l of o!.legs) if (l.kind === "ride") expect(l.route!.agency).toBe("MARTA");
  }, 90_000);

  it("UGA: no MARTA-to-Athens connection is invented for an Atlanta start", async () => {
    const deadline = zonedToUtc(day, 9 * 60);
    const plan = await planCommute(base({ campus: "uga", buildingId: MLC, deadline, modes: ["transit"] }), Date.now());
    expect(plan.recommended).toBeNull();
  }, 90_000);

  it("UGA: without a car, a bus itinerary from east Athens reaches the Miller Learning Center", async () => {
    const deadline = zonedToUtc(day, 9 * 60);
    const plan = await planCommute(base({ campus: "uga", buildingId: MLC, origin: { lon: -83.315, lat: 33.925, label: "Home" }, deadline, vehicle: { permits: [], registered: null, hasCar: false, mpg: null } }), Date.now());
    const rec = plan.recommended!;
    expect(rec.kind === "transit" || rec.kind === "walk").toBe(true);
    expect(rec.arriveAt!).toBeLessThanOrEqual(deadline);
  }, 90_000);

  it("finds the last bus back to a park-and-ride lot, or says there is none", async () => {
    const plan = await planCommute(
      base({ campus: "uga", buildingId: "", origin: { lon: -83.3746, lat: 33.9506, label: "MLC" }, toPoint: { lon: -83.3631, lat: 33.9351, label: "E23" }, lastService: true, modes: ["transit"] }),
      zonedToUtc(day, 12 * 60),
    );
    if (plan.recommended) expect(plan.recommended.leaveBy!).toBeGreaterThan(zonedToUtc(day, 12 * 60));
  }, 90_000);
});
