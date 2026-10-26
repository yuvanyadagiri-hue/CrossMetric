/**
 * ArriveBy on the real campus records (data/commute, data/published/commute) with a
 * deterministic stand-in for the routing service: no external service is called and
 * no time-of-day data is invented. Skipped when the commute pipeline outputs are missing.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildArrivalPlan, DEFAULT_TRAVEL_PREFERENCES, zonedToUtc } from "@crossmetric/engine/commute";
import { POST as arriveRoute } from "@/app/api/arriveby/plan/route";
import { parseArriveByRequest, planArrival, type ArriveByRequest } from "@/server/arriveby/plan";
import { fakeRouting } from "./helpers/fake-routing";

const published = path.resolve(process.cwd(), "..", "..", "data", "published", "commute");
const ready = ["campus-gt.json", "campus-uga.json", "transit-gt.json", "transit-uga.json"].every((f) => existsSync(path.join(published, f)));

const at = (date: string, time: string) => {
  const [h, m] = time.split(":").map(Number);
  return zonedToUtc(date, h! * 60 + m!);
};
const MIN = 60_000;
// Tuesday 2026-10-20, inside the campus rule records' review dates and the timetable periods.
const NOW = at("2026-10-20", "07:00");
const BY = at("2026-10-20", "09:30");

const DECATUR = { label: "Decatur", lon: -84.2963, lat: 33.7748 };
const KLAUS = { label: "Klaus Advanced Computing Building", lon: -84.396261, lat: 33.77684, source: "building" as const, campus: "gt" as const, buildingId: "w42706123" };
const EAST_ATHENS = { label: "East Athens", lon: -83.3496, lat: 33.9518 };
const ADERHOLD = { label: "Aderhold Hall", lon: -83.37287, lat: 33.941989, source: "building" as const, campus: "uga" as const, buildingId: "w598413188" };

function request(o: { origin?: typeof DECATUR; destination?: typeof KLAUS | typeof ADERHOLD; permits?: string[]; prefer?: ArriveByRequest["prefer"]; by?: number; parkUntil?: number | null; accessible?: boolean } = {}): ArriveByRequest {
  return {
    journey: {
      origin: o.origin ?? DECATUR,
      destination: o.destination ?? KLAUS,
      timing: { mode: "arrive", by: o.by ?? BY },
      prefs: { ...DEFAULT_TRAVEL_PREFERENCES, accessible: o.accessible ?? false },
      vehicle: { hasCar: true, permits: o.permits ?? [], registered: null, mpg: 30 },
      fuelPrice: 3.2,
      walkSpeedMps: 1.25,
      ...(o.parkUntil ? { parkUntil: o.parkUntil } : {}),
    },
    prefer: o.prefer ?? "drive",
    preferredPlaceId: null,
  };
}

beforeEach(() => vi.stubGlobal("fetch", fakeRouting()));
afterEach(() => vi.unstubAllGlobals());

describe("ArriveBy requests", () => {
  const body = (o: Record<string, unknown> = {}) => ({ origin: DECATUR, destination: KLAUS, arriveBy: BY, prefs: {}, vehicle: { hasCar: true }, ...o });

  it("needs an explicit arrival time and rejects one that has passed", () => {
    expect(parseArriveByRequest(body({ arriveBy: undefined }), NOW)).toMatchObject({ ok: false, field: "timing" });
    const past = parseArriveByRequest(body({ arriveBy: at("2026-10-20", "06:00") }), NOW);
    expect(past.ok).toBe(false);
    if (!past.ok) expect(past.error).toMatch(/passed/);
    expect(parseArriveByRequest(body(), NOW)).toMatchObject({ ok: true, value: { prefer: "best", journey: { timing: { mode: "arrive", by: BY } } } });
  });

  it("validates the preference, the chosen place and the stay end", () => {
    const ok = parseArriveByRequest(body({ prefer: "teleport", preferredPlaceId: "DROP TABLE", parkUntil: BY - 3600_000 }), NOW);
    expect(ok).toMatchObject({ ok: true, value: { prefer: "best", preferredPlaceId: null } });
    if (ok.ok) expect(ok.value.journey.parkUntil).toBeUndefined();
    const stay = parseArriveByRequest(body({ prefer: "transit", preferredPlaceId: "gt-W23", parkUntil: BY + 4 * 3600_000 }), NOW);
    expect(stay).toMatchObject({ ok: true, value: { prefer: "transit", preferredPlaceId: "gt-W23", journey: { parkUntil: BY + 4 * 3600_000 } } });
  });

  it("returns 400 from the API for a past time", async () => {
    const res = await arriveRoute(new Request("http://localhost", { method: "POST", body: JSON.stringify(body({ arriveBy: Date.now() - 3600_000 })) }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { field: string }).field).toBe("timing");
  });
});

describe.skipIf(!ready)("ArriveBy on the Georgia Tech and UGA records", () => {
  it("plans a Georgia Tech arrival: leave-by from the parts, a deck you may use, and a backup", async () => {
    const r = await planArrival(request({ permits: ["W23"] }), NOW);
    const p = r.plan;
    expect(p.status).toBe("ok");
    expect(r.campus).toBe("gt");
    expect(p.destination.entrance).toMatchObject({ kind: "main", provenance: { status: "community" } });
    expect(p.primary!.kind).toBe("drive");
    // The deadline minus every part's high end is the leave-by time.
    const high = p.primary!.components.reduce((s, c) => s + c.minutes.high, 0);
    expect(Math.abs(BY - high * MIN - p.primary!.window.leaveBy)).toBeLessThanOrEqual(2 * MIN);
    expect(p.primary!.components.map((c) => c.kind)).toEqual(["drive", "park_search", "walk"]);
    // Every deck near Klaus is checked and listed with its rule source and verification date.
    expect(p.parking!.places.length).toBe(5);
    const north = p.parking!.places.find((x) => x.placeId === "gt-W23")!;
    expect(north.access).toBe("your_permit");
    expect(north.rules.status).toBe("user");
    const visitor = p.parking!.places.find((x) => x.access === "pay")!;
    expect(visitor.rules).toMatchObject({ status: "official", retrieved: "2026-10-12", reviewBy: "2026-11-12" });
    expect(visitor.rules.url).toMatch(/^https:\/\/www\.pts\.gatech\.edu\//);
    // No occupancy data exists: never shown as available.
    for (const x of p.parking!.places) expect(x.occupancy.provenance.status).toBe("unknown");
    expect(p.parking!.backup).not.toBeNull();
    expect(p.backup.kind).toBe("place");
    expect(p.backup.text).toMatch(/Availability has not been verified/);
    expect(p.comparison.find((c) => c.chosen)!.kind).toBe("drive");
  });

  it("re-runs the same engine on the returned basis, for instant changes in the app", async () => {
    const r = await planArrival(request({ permits: ["W23"] }), NOW);
    const again = buildArrivalPlan({ ...r.basis, now: NOW, prefer: "drive", preferredPlaceId: null });
    expect(again.primary!.optionId).toBe(r.plan.primary!.optionId);
    const other = r.plan.parking!.backup!.placeId;
    const moved = buildArrivalPlan({ ...r.basis, now: NOW, prefer: "drive", preferredPlaceId: other });
    expect(moved.parking!.primary!.placeId).toBe(other);
    expect(moved.primary!.optionId).toBe(`drive:${other}`);
  });

  it("treats an unknown permit as no permit and says so", async () => {
    const r = await planArrival(request({ permits: ["Z99"] }), NOW);
    expect(r.plan.notices.join(" ")).toMatch(/Z99 doesn't match a parking place CrossMetric has rules for at Georgia Tech/);
    expect(r.plan.parking!.places.every((x) => x.access !== "your_permit")).toBe(true);
  });

  it("excludes UGA lots that need a permit you don't have, and keeps them listed with the reason", async () => {
    const r = await planArrival(request({ origin: EAST_ATHENS, destination: ADERHOLD, by: at("2026-10-20", "10:00") }), NOW);
    const places = r.plan.parking!.places;
    const restricted = places.filter((x) => x.verdict === "restricted");
    expect(restricted.length).toBeGreaterThan(0);
    for (const x of restricted) expect(x.reason).toMatch(/Permit required|Registered|Not available/);
    if (r.plan.parking!.primary) expect(["pay", "free"]).toContain(r.plan.parking!.primary.access);
    expect(r.plan.primary).not.toBeNull();
  });

  it("checks the whole stay when you say when you leave campus", async () => {
    const r = await planArrival(request({ permits: [], parkUntil: at("2026-10-20", "13:30") }), NOW);
    expect(r.plan.parking!.stayChecked).toBe(true);
    // Four hours on the standard visitor rate.
    expect(r.plan.parking!.primary!.price).toBeGreaterThan(0);
  });

  it("states when step-free access can't be confirmed", async () => {
    const r = await planArrival(request({ accessible: true, prefer: "best" }), NOW);
    expect(r.plan.access.status).toBe("unconfirmed");
    expect(r.plan.access.summary).toMatch(/can't confirm/);
  });

  it("stays honest when the routing service is down", async () => {
    vi.stubGlobal("fetch", fakeRouting(true));
    // A start not used above, so nothing is answered from the routing cache.
    const r = await planArrival(request({ origin: { label: "Kirkwood", lon: -84.3186, lat: 33.7535 }, permits: ["W23"] }), NOW);
    expect(r.plan.primary?.kind).not.toBe("drive");
    expect(r.plan.parking!.primary).toBeNull();
    expect(r.plan.parking!.places.every((x) => x.verdict === "unavailable")).toBe(true);
    expect(r.plan.parking!.emptyReason).toBe("Driving times couldn't be calculated right now.");
    expect(r.notes.join(" ")).toMatch(/unavailable/);
  });
});
