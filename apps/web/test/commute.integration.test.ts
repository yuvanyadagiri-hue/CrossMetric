/**
 * Commuter API and rule records on the real data (data/commute + data/published/commute).
 * Skipped when the commute pipeline outputs are missing. No external services are called.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluateStay, zonedToUtc, type VehicleProfile } from "@crossmetric/engine/commute";
import { GET as campusRoute } from "@/app/api/commute/campus/route";
import { DELETE as undoObs, GET as listObs, POST as postObs } from "@/app/api/commute/observations/route";
import { POST as parkingRoute } from "@/app/api/commute/parking/route";
import { POST as planRoute } from "@/app/api/commute/plan/route";
import { GET as stopsRoute } from "@/app/api/commute/stops/route";
import type { CampusBundle, ParkingResponse } from "@/lib/commute-types";
import { getCampus } from "@/server/commute/data";
import { transitDay } from "@/server/commute/transit";

const published = path.resolve(process.cwd(), "..", "..", "data", "published", "commute");
const ready = existsSync(path.join(published, "campus-gt.json")) && existsSync(path.join(published, "transit-uga.json"));

const at = (date: string, time: string) => {
  const [h, m] = time.split(":").map(Number);
  return zonedToUtc(date, h! * 60 + m!);
};
const post = (body: unknown) => new Request("http://localhost", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 200)}` }, body: JSON.stringify(body) });
const NO_PERMIT: VehicleProfile = { permits: [], registered: false };
// Evaluate as of a date inside the rule records' review window.
const NOW = at("2026-10-13", "07:00");

describe.skipIf(!ready)("official rule records", () => {
  it("GT: no permit after 5 p.m. is never assumed free; only paid visitor places qualify", async () => {
    const gt = await getCampus("gt");
    const results = gt.bundle.parking.map((p) => evaluateStay(gt.rules.get(p.id)!, NO_PERMIT, at("2026-10-13", "17:30"), at("2026-10-13", "20:00"), NOW));
    expect(results.some((r) => r.status === "allowed")).toBe(false);
    const deck = evaluateStay(gt.rules.get("gt-W02")!, NO_PERMIT, at("2026-10-13", "17:30"), at("2026-10-13", "20:00"), NOW);
    expect(deck).toMatchObject({ status: "requires_action", price: 9 });
  });

  it("GT: a declared permit for its own area is honoured", async () => {
    const gt = await getCampus("gt");
    expect(evaluateStay(gt.rules.get("gt-W23")!, { permits: ["W23"], registered: null }, at("2026-10-13", "08:00"), at("2026-10-13", "17:00"), NOW).status).toBe("allowed");
    expect(evaluateStay(gt.rules.get("gt-W02")!, { permits: ["W23"], registered: null }, at("2026-10-13", "08:00"), at("2026-10-13", "17:00"), NOW).status).toBe("requires_action");
  });

  it("UGA: an after-hours lot that needs a registered vehicle distinguishes registration from a permit", async () => {
    const uga = await getCampus("uga");
    const tsl = uga.rules.get("uga-TSL")!;
    const evening = [at("2026-10-13", "17:30"), at("2026-10-13", "21:00")] as const;
    expect(evaluateStay(tsl, NO_PERMIT, ...evening, NOW).reason).toBe("Registered vehicles only");
    expect(evaluateStay(tsl, { permits: [], registered: null }, ...evening, NOW).status).toBe("unknown");
    expect(evaluateStay(tsl, { permits: [], registered: true }, ...evening, NOW)).toMatchObject({ status: "allowed", price: 0 });
    // A registered vehicle without a permit still cannot use the lot in the daytime.
    expect(evaluateStay(tsl, { permits: [], registered: true }, at("2026-10-13", "15:00"), at("2026-10-13", "18:00"), NOW).status).toBe("prohibited");
    // N04 also offers pay-per-hour after 5 PM, but the rate is not published: payable, price unknown.
    expect(evaluateStay(uga.rules.get("uga-N04")!, NO_PERMIT, ...evening, NOW)).toMatchObject({ status: "requires_action", price: null, reason: "Pay-per-hour" });
  });

  it("UGA: a rule change during class rejects the stay before it starts", async () => {
    const uga = await getCampus("uga");
    const r = evaluateStay(uga.rules.get("uga-S02")!, NO_PERMIT, at("2026-10-13", "16:00"), at("2026-10-13", "18:00"), NOW);
    expect(r.status).toBe("prohibited");
    expect(evaluateStay(uga.rules.get("uga-S02")!, NO_PERMIT, at("2026-10-13", "17:05"), at("2026-10-13", "22:00"), NOW)).toMatchObject({ status: "allowed", price: 0 });
  });

  it("UGA: a home game overrides weekend free parking (including the evening before)", async () => {
    const uga = await getCampus("uga");
    const s02 = uga.rules.get("uga-S02")!;
    expect(evaluateStay(s02, NO_PERMIT, at("2026-10-17", "10:00"), at("2026-10-17", "14:00"), NOW).status).toBe("unknown");
    expect(evaluateStay(s02, NO_PERMIT, at("2026-10-16", "18:00"), at("2026-10-16", "20:00"), NOW).status).toBe("unknown");
    expect(evaluateStay(s02, NO_PERMIT, at("2026-10-24", "10:00"), at("2026-10-24", "14:00"), NOW)).toMatchObject({ status: "allowed", price: 0 });
  });

  it("UGA: visitor deck rates and morning restrictions come from the visitor page", async () => {
    const uga = await getCampus("uga");
    expect(evaluateStay(uga.rules.get("uga-N06")!, NO_PERMIT, at("2026-10-13", "09:00"), at("2026-10-13", "11:30"), NOW)).toMatchObject({ status: "requires_action", price: 9 });
    expect(evaluateStay(uga.rules.get("uga-E04")!, NO_PERMIT, at("2026-10-13", "09:00"), at("2026-10-13", "19:00"), NOW).status).not.toBe("allowed");
    // Hull St. Deck: pay-per-hour unavailable Mon-Thu mornings.
    expect(evaluateStay(uga.rules.get("uga-W05")!, NO_PERMIT, at("2026-10-13", "09:00"), at("2026-10-13", "11:00"), NOW).status).toBe("prohibited");
    expect(evaluateStay(uga.rules.get("uga-W05")!, NO_PERMIT, at("2026-10-16", "09:00"), at("2026-10-16", "11:00"), NOW).status).toBe("requires_action");
  });

  it("UGA: park-and-ride lots take a $5 ParkMobile day rate or a park-and-ride permit", async () => {
    const uga = await getCampus("uga");
    const e23 = uga.rules.get("uga-E23")!;
    expect(evaluateStay(e23, NO_PERMIT, at("2026-10-13", "08:00"), at("2026-10-13", "15:00"), NOW)).toMatchObject({ status: "requires_action", price: 5 });
    expect(evaluateStay(e23, { permits: ["E23"], registered: null }, at("2026-10-13", "08:00"), at("2026-10-13", "15:00"), NOW)).toMatchObject({ status: "allowed", price: 0 });
  });

  it("weekday small hours are not published, so they are unknown rather than free", async () => {
    const uga = await getCampus("uga");
    expect(evaluateStay(uga.rules.get("uga-S02")!, NO_PERMIT, at("2026-10-14", "01:00"), at("2026-10-14", "03:00"), NOW).reason).toBe("No published rule for this time");
  });

  it("rule records past their review date become unknown", async () => {
    const gt = await getCampus("gt");
    expect(evaluateStay(gt.rules.get("gt-W02")!, NO_PERMIT, at("2026-12-01", "10:00"), at("2026-12-01", "11:00"), at("2026-12-01", "09:00")).reason).toBe("Rules need re-checking");
  });
});

describe.skipIf(!ready)("transit service calendars", () => {
  it("applies the official UGA calendar on top of the Passio feed", async () => {
    expect((await transitDay("uga", "2026-10-20")).status).toBe("scheduled");
    const closed = await transitDay("uga", "2026-10-31");
    expect(closed.status).toBe("no_service");
    expect(closed.forward.patterns.some((p) => closed.net.routes[closed.net.patterns[p.source]!.route]!.feed === "uga")).toBe(false);
    // ACC buses still run that day (their own feed has the calendar).
    expect(closed.forward.patterns.some((p) => closed.net.routes[closed.net.patterns[p.source]!.route]!.feed === "acc")).toBe(true);
    expect((await transitDay("uga", "2026-10-17")).status).toBe("modified");
    expect((await transitDay("uga", "2026-11-05")).status).toBe("calendar_unconfirmed");
  });

  it("reports when the MARTA schedule does not cover a date", async () => {
    expect((await transitDay("gt", "2026-10-20")).status).toBe("scheduled");
    expect((await transitDay("gt", "2027-01-20")).status).toBe("not_covered");
  });
});

describe.skipIf(!ready)("commute API", () => {
  let dir = "";
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "cm-obs-"));
    process.env.COMMUNITY_DATA_DIR = dir;
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("serves a campus bundle with buildings, parking and sources", async () => {
    const res = await campusRoute(new NextRequest("http://localhost/api/commute/campus?id=gt"));
    expect(res.status).toBe(200);
    const b = (await res.json()) as CampusBundle;
    expect(b.buildings.length).toBeGreaterThan(100);
    expect(b.buildings.some((x) => /Parking Deck/i.test(x.name))).toBe(false);
    expect(b.parking.map((p) => p.id)).toContain("gt-W02");
    expect(b.sources["gt-visitor"]!.url).toMatch(/^https:\/\/www\.pts\.gatech\.edu/);
    expect((await campusRoute(new NextRequest("http://localhost/api/commute/campus?id=mit"))).status).toBe(400);
  });

  it("evaluates parking as 'rules now' without a stay, and in full with one", async () => {
    const now = Date.now();
    const res = await parkingRoute(post({ campus: "gt", vehicle: { permits: [], registered: null }, at: now, until: null }));
    const body = (await res.json()) as ParkingResponse;
    expect(body.results.every((r) => r.mode === "now" && r.price === null)).toBe(true);
    const stay = (await (await parkingRoute(post({ campus: "gt", vehicle: { permits: [] }, at: now, until: now + 2 * 3600_000 }))).json()) as ParkingResponse;
    expect(stay.results.every((r) => r.mode === "stay")).toBe(true);
  });

  it("validates plan requests", async () => {
    expect((await planRoute(post({ campus: "mit" }))).status).toBe(400);
    expect((await planRoute(post({ campus: "gt", origin: { lon: -73.9, lat: 40.7 }, buildingId: "w42706123", deadline: Date.now() + 3600_000 }))).status).toBe(400);
    expect((await planRoute(post({ campus: "gt", origin: { lon: -84.39, lat: 33.78 }, buildingId: "../../etc", deadline: Date.now() + 3600_000 }))).status).toBe(400);
    expect((await planRoute(post({ campus: "gt", origin: { lon: -84.39, lat: 33.78 }, buildingId: "w1", deadline: Date.now() + 3600_000 }))).status).toBe(400);
  });

  it("takes one-tap reports, shows them as observations, and lets the reporter undo", async () => {
    const key = "test-device-key-0001";
    const created = await postObs(post({ campus: "gt", placeId: "gt-W02", kind: "opening", deviceKey: key }));
    expect(created.status).toBe(201);
    const c = (await created.json()) as { id: string; summary: { state: string; reports: number; label: string } };
    expect(c.summary).toMatchObject({ state: "opening", reports: 1 });
    expect(c.summary.label).toMatch(/^Opening reported · /);
    // Same person, same place, right away: rate limited.
    expect((await postObs(post({ campus: "gt", placeId: "gt-W02", kind: "full", deviceKey: key }))).status).toBe(429);
    // Meter reports go to review and never show as availability.
    const meter = (await (await postObs(post({ campus: "gt", placeId: "gt-W23", kind: "meter_active", deviceKey: key }))).json()) as { review: boolean };
    expect(meter.review).toBe(true);
    const list = (await (await listObs(new NextRequest("http://localhost/api/commute/observations?campus=gt"))).json()) as { summaries: { placeId: string }[] };
    expect(list.summaries.map((s) => s.placeId)).toEqual(["gt-W02"]);
    // Someone else cannot undo it; the reporter can.
    expect((await undoObs(post({ id: c.id, deviceKey: "another-device-key-01" }))).status).toBe(410);
    expect((await undoObs(post({ id: c.id, deviceKey: key }))).status).toBe(200);
    const after = (await (await listObs(new NextRequest("http://localhost/api/commute/observations?campus=gt"))).json()) as { summaries: unknown[] };
    expect(after.summaries).toEqual([]);
  });

  it("rejects implausible report locations and unknown places", async () => {
    const far = await postObs(post({ campus: "gt", placeId: "gt-E81", kind: "full", deviceKey: "test-device-key-0002", location: { lon: -84.2, lat: 33.9 } }));
    expect(far.status).toBe(422);
    expect((await postObs(post({ campus: "gt", placeId: "gt-XX", kind: "full", deviceKey: "test-device-key-0002" }))).status).toBe(400);
  });

  it("lists scheduled departures (never live positions) at a stop", async () => {
    const res = await stopsRoute(new NextRequest("http://localhost/api/commute/stops?campus=uga&lon=-83.3746&lat=33.9506"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { stops: { scheduledOnly: boolean; arrivals: unknown[] }[] };
    expect(body.stops.length).toBeGreaterThan(0);
    expect(body.stops.every((s) => s.scheduledOnly)).toBe(true);
  });
});
