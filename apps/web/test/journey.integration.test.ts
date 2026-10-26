/**
 * Georgia-wide journey planning on the real timetables and rule records
 * (data/published/commute, data/commute), with a deterministic stand-in for the
 * routing service so no external service is called. Skipped when the commute
 * pipeline outputs are missing.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TRAVEL_PREFERENCES, zonedToUtc, type TravelPreferences, type TripTiming } from "@crossmetric/engine/commute";
import { POST as journeyRoute } from "@/app/api/journey/plan/route";
import type { JourneyRequest, JourneyResponse } from "@/lib/journey-types";
import { journeyKey } from "@/lib/journey-types";
import { nearbyTransit, tidyStopName } from "@/server/journey/nearby";
import { planJourney } from "@/server/journey/plan";
import { parseJourneyRequest } from "@/server/journey/request";

const published = path.resolve(process.cwd(), "..", "..", "data", "published", "commute");
const ready = existsSync(path.join(published, "transit-gt.json")) && existsSync(path.join(published, "transit-uga.json"));

const at = (date: string, time: string) => {
  const [h, m] = time.split(":").map(Number);
  return zonedToUtc(date, h! * 60 + m!);
};
const MIN = 60_000;
// Tuesday morning inside the MARTA, UGA and ACC timetable periods.
const NOW = at("2026-10-20", "08:00");

const LINDBERGH = { label: "Near Lindbergh Center", lon: -84.3693, lat: 33.8236 };
const FIVE_POINTS = { label: "Five Points", lon: -84.3915, lat: 33.7537 };
const CUMMING = { label: "Cumming", lon: -84.1402, lat: 34.2073 };
const DOWNTOWN_ATHENS = { label: "Downtown Athens", lon: -83.3762, lat: 33.9596 };
const ATHENS_EAST = { label: "East Athens", lon: -83.3496, lat: 33.9518 };

// ---------------------------------------------------------------------------
// A predictable routing service: straight lines at fixed speeds with a detour factor.
// ---------------------------------------------------------------------------

function haversine(a: [number, number], b: [number, number]) {
  const k = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  return Math.hypot((a[0] - b[0]) * k, a[1] - b[1]) * 111_195;
}
function encode(points: [number, number][]) {
  let out = "";
  let pLat = 0;
  let pLon = 0;
  const enc = (v: number) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    while (n >= 0x20) {
      out += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    out += String.fromCharCode(n + 63);
  };
  for (const [lon, lat] of points) {
    const iLat = Math.round(lat * 1e6);
    const iLon = Math.round(lon * 1e6);
    enc(iLat - pLat);
    enc(iLon - pLon);
    pLat = iLat;
    pLon = iLon;
  }
  return out;
}
const SPEED: Record<string, number> = { pedestrian: 1.3, bicycle: 4.5, auto: 13 };
type Loc = { lon: number; lat: number };

let calls: string[] = [];
function fakeRouting(down = false) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (down) throw new TypeError("fetch failed");
    if (!url.includes("valhalla")) return new Response("unavailable", { status: 503 });
    const body = JSON.parse(String(init?.body ?? "{}")) as { locations?: Loc[]; sources?: Loc[]; targets?: Loc[]; costing?: string; alternates?: number };
    const speed = SPEED[body.costing ?? "auto"] ?? 13;
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } });
    if (url.endsWith("/route")) {
      const [a, b] = body.locations!;
      const m = haversine([a!.lon, a!.lat], [b!.lon, b!.lat]) * 1.3;
      const trip = (bend: number) => {
        const mid: [number, number] = [(a!.lon + b!.lon) / 2 + bend, (a!.lat + b!.lat) / 2 - bend];
        return { trip: { summary: { length: (m * (1 + Math.abs(bend) * 40)) / 1000, time: (m * (1 + Math.abs(bend) * 20)) / speed }, legs: [{ shape: encode([[a!.lon, a!.lat], mid, [b!.lon, b!.lat]]), maneuvers: [{ instruction: "Head north.", length: m / 1000, time: m / speed, begin_shape_index: 0 }] }] } };
      };
      return json({ ...trip(0), alternates: body.alternates ? [trip(0.004)] : [] });
    }
    if (url.endsWith("/sources_to_targets")) {
      return json({ sources_to_targets: body.sources!.map((s) => body.targets!.map((t) => { const m = haversine([s.lon, s.lat], [t.lon, t.lat]) * 1.3; return { distance: m / 1000, time: m / speed }; })) });
    }
    if (url.endsWith("/trace_attributes")) return json({ edges: [] });
    return new Response("{}", { status: 404 });
  });
}

const prefs = (p: Partial<TravelPreferences> = {}): TravelPreferences => ({ ...DEFAULT_TRAVEL_PREFERENCES, ...p, modes: { ...DEFAULT_TRAVEL_PREFERENCES.modes, ...(p.modes ?? {}) } });
const request = (o: Partial<JourneyRequest> & { timing: TripTiming }): JourneyRequest => ({
  origin: LINDBERGH,
  destination: FIVE_POINTS,
  prefs: prefs(),
  vehicle: { hasCar: true, permits: [], registered: null, mpg: 30 },
  fuelPrice: 3.2,
  walkSpeedMps: 1.25,
  ...o,
});

beforeEach(() => {
  calls = [];
  vi.stubGlobal("fetch", fakeRouting());
});
afterEach(() => vi.unstubAllGlobals());

describe("journey requests (regression: no silent move to tomorrow)", () => {
  const body = (timing: unknown) => ({ origin: LINDBERGH, destination: FIVE_POINTS, timing, prefs: {}, vehicle: { hasCar: true } });

  it("requires an explicit timing and never invents one", () => {
    const r = parseJourneyRequest(body(undefined), NOW);
    expect(r).toMatchObject({ ok: false, field: "timing" });
    expect(parseJourneyRequest(body({ mode: "now" }), NOW)).toMatchObject({ ok: true, value: { timing: { mode: "now" } } });
  });

  it("rejects an arrival time that has passed instead of moving it to tomorrow", () => {
    const r = parseJourneyRequest(body({ mode: "arrive", by: at("2026-10-20", "07:00") }), NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/passed/);
  });

  it("keeps future departures and deadlines exactly", () => {
    const by = at("2026-10-21", "09:00");
    expect(parseJourneyRequest(body({ mode: "arrive", by }), NOW)).toMatchObject({ ok: true, value: { timing: { mode: "arrive", by } } });
  });

  it("validates places and preferences", () => {
    expect(parseJourneyRequest({ ...body({ mode: "now" }), destination: { lon: -86.8, lat: 33.5, label: "Birmingham" } }, NOW)).toMatchObject({ ok: false, field: "destination" });
    expect(parseJourneyRequest({ ...body({ mode: "now" }), destination: LINDBERGH }, NOW)).toMatchObject({ ok: false });
    const ok = parseJourneyRequest({ ...body({ mode: "now" }), prefs: { modes: { drive: false }, maxWalkMin: 500, priority: "nonsense" } }, NOW);
    expect(ok).toMatchObject({ ok: true, value: { prefs: { maxWalkMin: null, priority: "balanced", modes: { drive: false, walk: true } } } });
  });

  it("gives every change of origin, destination, timing or preference a different result key", () => {
    const base = request({ timing: { mode: "now" } });
    const k = journeyKey(base);
    expect(journeyKey({ ...base, origin: CUMMING })).not.toBe(k);
    expect(journeyKey({ ...base, destination: CUMMING })).not.toBe(k);
    expect(journeyKey({ ...base, timing: { mode: "depart", at: NOW } })).not.toBe(k);
    expect(journeyKey({ ...base, prefs: prefs({ modes: { ...DEFAULT_TRAVEL_PREFERENCES.modes, drive: false } }) })).not.toBe(k);
    expect(journeyKey({ ...base })).toBe(k);
  });

  it("returns 400 from the API for a past time", async () => {
    const res = await journeyRoute(new Request("http://localhost", { method: "POST", body: JSON.stringify(body({ mode: "depart", at: Date.now() - 3 * 3600_000 })) }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { field: string }).field).toBe("timing");
  });
});

describe.skipIf(!ready)("journey planning on real timetables", () => {
  const plan = (r: JourneyRequest, now = NOW) => planJourney(r, now);

  it("leave now: every option starts now and the label says so", async () => {
    const p = await plan(request({ timing: { mode: "now" } }));
    expect(p.timingLabel).toBe("Leave now");
    expect(p.options.length).toBeGreaterThan(1);
    for (const o of p.options) {
      expect(o.leaveAt).toBe(NOW);
      expect(o.arriveAt).toBeGreaterThan(NOW);
      expect(o.arriveAt - NOW).toBeLessThan(3 * 3600_000);
    }
    const transit = p.options.find((o) => o.kind === "transit")!;
    expect(transit.scheduled).toBe(true);
    // Scheduled departures are on today's service, not tomorrow's.
    const firstRide = transit.legs.find((l) => l.kind === "ride")!;
    expect(firstRide.depart!).toBeGreaterThanOrEqual(NOW);
    expect(firstRide.depart! - NOW).toBeLessThan(60 * MIN);
    expect(p.options[0]!.roles).toContain("best");
  });

  it("depart at a chosen time: the trip starts then, on that day's timetable", async () => {
    const departAt = at("2026-10-22", "07:30");
    const p = await plan(request({ timing: { mode: "depart", at: departAt } }));
    expect(p.timingLabel).toBe("Depart Thu, Oct 22 7:30 AM");
    for (const o of p.options) expect(o.leaveAt).toBe(departAt);
    const ride = p.options.find((o) => o.kind === "transit")!.legs.find((l) => l.kind === "ride")!;
    expect(ride.depart!).toBeGreaterThanOrEqual(departAt);
    expect(ride.depart! - departAt).toBeLessThan(45 * MIN);
  });

  it("arrive by: every option arrives by the deadline and leaves before it", async () => {
    const by = at("2026-10-21", "09:00");
    const p = await plan(request({ timing: { mode: "arrive", by } }));
    expect(p.timingLabel).toBe("Arrive by Tomorrow 9:00 AM");
    expect(p.options.length).toBeGreaterThan(0);
    for (const o of p.options) {
      expect(o.arriveAt).toBeLessThanOrEqual(by);
      expect(o.leaveAt).toBeLessThan(by);
      expect(o.leaveAt).toBeGreaterThan(NOW);
    }
    expect(p.late).toBeNull();
  });

  it("arrive by a time that cannot be met says how late, from leaving now", async () => {
    const p = await plan(request({ timing: { mode: "arrive", by: NOW + 3 * MIN } }));
    expect(p.options).toEqual([]);
    expect(p.late).not.toBeNull();
    expect(p.late!.lateMin).toBeGreaterThan(0);
    expect(p.late!.option.leaveAt).toBe(NOW);
  });

  it("never offers driving to someone who turned it off", async () => {
    const p = await plan(request({ timing: { mode: "now" }, prefs: prefs({ modes: { ...DEFAULT_TRAVEL_PREFERENCES.modes, drive: false } }) }));
    expect(p.options.length).toBeGreaterThan(0);
    expect(p.options.some((o) => o.kind === "drive" || o.kind === "park_ride")).toBe(false);
    expect(p.options.some((o) => o.legs.some((l) => l.kind === "drive"))).toBe(false);
  });

  it("removes options over the walking limit and says why", async () => {
    // Midtown to Five Points is about 3 km: walkable, but well over 10 minutes.
    const p = await plan(request({ origin: { label: "Midtown", lon: -84.3833, lat: 33.781 }, timing: { mode: "now" }, prefs: prefs({ maxWalkMin: 10 }) }));
    expect(p.options.every((o) => o.walkMin <= 10.5)).toBe(true);
    const walk = p.excluded.find((e) => e.kind === "walk");
    expect(walk?.reasons[0]).toMatch(/min of walking \(your limit is 10\)/);
  });

  it("checks step-free access against MARTA's published data", async () => {
    const p = await plan(request({ timing: { mode: "now" }, prefs: prefs({ accessible: true }) }));
    for (const o of p.options) expect(o.access === "verified" || o.access === "not_applicable").toBe(true);
    const t = p.options.find((o) => o.kind === "transit");
    if (t) expect(t.accessNote).toMatch(/MARTA lists every stop and trip used as wheelchair accessible/);
  });

  it("Cumming to downtown Atlanta: no walkable transit, so drive or drive to a MARTA station with parking", async () => {
    const p = await plan(request({ origin: CUMMING, timing: { mode: "now" } }));
    expect(p.options.some((o) => o.kind === "transit")).toBe(false);
    const pr = p.options.find((o) => o.kind === "park_ride");
    expect(pr).toBeDefined();
    expect(pr!.title).toMatch(/station \+/);
    expect(pr!.parkingNote).toMatch(/MARTA/);
    expect(pr!.legs[0]!.kind).toBe("drive");
    expect(p.options.find((o) => o.kind === "drive")!.parkingNote).toMatch(/isn't included/);
    expect(p.coverage.transit.find((c) => c.network === "atlanta")!.reaches).toBe(false);
  });

  it("Atlanta to Athens: says no transit serves both places instead of inventing one", async () => {
    const p = await plan(request({ origin: LINDBERGH, destination: DOWNTOWN_ATHENS, timing: { mode: "now" }, prefs: prefs({ modes: { ...DEFAULT_TRAVEL_PREFERENCES.modes, drive: false, park_ride: false } }) }));
    expect(p.options.some((o) => o.kind === "transit")).toBe(false);
    expect(p.coverage.transitSummary).toMatch(/No public transit/);
  });

  it("Athens: fare-free buses are priced at $0 and labelled scheduled", async () => {
    const p = await plan(request({ origin: ATHENS_EAST, destination: DOWNTOWN_ATHENS, timing: { mode: "depart", at: at("2026-10-21", "10:00") } }));
    const t = p.options.find((o) => o.kind === "transit");
    expect(t).toBeDefined();
    expect(t!.costUsd).toBe(0);
    expect(t!.costNote).toBe("Fare-free");
    expect(t!.notes[0]).toMatch(/Scheduled times, not live/);
  });

  it("claims lowest cost only from known costs, and labels distinct alternatives", async () => {
    const p = await plan(request({ timing: { mode: "now" } }));
    const cheapest = p.options.find((o) => o.roles.includes("cheapest"));
    if (cheapest) expect(cheapest.costUsd).not.toBeNull();
    const fastest = p.options.find((o) => o.roles.includes("fastest"))!;
    for (const o of p.options) expect(o.durationMin).toBeGreaterThanOrEqual(fastest.durationMin - 1);
    expect(p.options.every((o) => o.explanation.length > 0)).toBe(true);
  });

  it("when the routing service is down, transit timetables still work and the gap is stated", async () => {
    vi.stubGlobal("fetch", fakeRouting(true));
    // Different points from the other tests: the routing client caches answers.
    const p = await plan(request({ origin: { label: "Ansley Park", lon: -84.3772, lat: 33.7947 }, destination: { label: "Downtown", lon: -84.3893, lat: 33.7561 }, timing: { mode: "now" } }));
    expect(p.options.length).toBeGreaterThan(0);
    expect(p.options.every((o) => o.kind === "transit")).toBe(true);
    expect(p.notes.join(" ")).toMatch(/Walking routes are unavailable right now/);
    expect(p.notes.join(" ")).toMatch(/Driving routes are unavailable right now/);
    expect(p.notes.join(" ")).toMatch(/Weather unavailable/);
  });
});

describe.skipIf(!ready)("nearby transit", () => {
  it("ranks stations near Five Points by walking time, with scheduled departures only", async () => {
    const r = await nearbyTransit([FIVE_POINTS.lon, FIVE_POINTS.lat], { now: NOW });
    expect(r.scheduledOnly).toBe(true);
    expect(r.stations.length).toBeGreaterThan(2);
    expect(r.stations[0]!.kind).toBe("rail");
    expect(r.stations[0]!.name).toBe("Five Points Station");
    const mins = r.stations.map((s) => s.walkMin ?? Infinity);
    expect([...mins].sort((a, b) => a - b)).toEqual(mins);
    expect(r.stations[0]!.departures.every((d) => d.time >= NOW && d.time <= NOW + 60 * MIN)).toBe(true);
    expect(r.nearestRail).toBeNull();
  });

  it("from Cumming: no stops nearby; the nearest MARTA rail station is a drive away", async () => {
    const r = await nearbyTransit([CUMMING.lon, CUMMING.lat], { now: NOW });
    expect(r.stations).toEqual([]);
    expect(r.coverage).toMatch(/No MARTA, Athens-Clarke County Transit or UGA Campus Transit stops/);
    expect(r.nearestRail!.station.name).toMatch(/Station$/);
    expect(r.nearestRail!.driveMin).toBeGreaterThan(10);
  });

  it("rail only filters out bus stops", async () => {
    const r = await nearbyTransit([LINDBERGH.lon, LINDBERGH.lat], { now: NOW, railOnly: true });
    expect(r.stations.every((s) => s.kind === "rail")).toBe(true);
    expect(r.stations[0]?.name).toBe("Lindbergh Center Station");
    expect(r.stations[0]?.parking).toMatch(/free for the first 14 hours, then \$10\/day/);
  });

  it("tidies upper-case stop names", () => {
    expect(tidyStopName("PEACHTREE ST NE @ 10TH ST")).toBe("Peachtree St NE @ 10th St");
    expect(tidyStopName("Tate Center")).toBe("Tate Center");
  });
});

export type { JourneyResponse };
