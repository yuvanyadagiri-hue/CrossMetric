/**
 * ArriveBy plan assembly on deterministic fixtures. The places, times and lots
 * here are fictional test data, not Georgia Tech or UGA estimates.
 */
import { describe, expect, it } from "vitest";
import {
  arrivalComponents,
  assessParking,
  buildArrivalPlan,
  chooseParking,
  describeEntrance,
  evaluateNow,
  leaveWindow,
  permitMatch,
  pickEntrance,
  sumRange,
  zonedToUtc,
  type ArrivalOptionInput,
  type ArrivalPlanInput,
  type OccupancyEvidence,
  type ParkingCheckInput,
  type ParkingPlaceRules,
  type SourceInfo,
} from "../src/commute";

const at = (date: string, time: string) => {
  const [h, m] = time.split(":").map(Number);
  return zonedToUtc(date, h! * 60 + m!);
};
const MIN = 60_000;
// A Tuesday: arrive by 9:30, planning at 7:30.
const NOW = at("2026-10-20", "07:30");
const DEADLINE = at("2026-10-20", "09:30");
const ALL = [0, 1, 2, 3, 4, 5, 6] as const;

const SOURCES: Record<string, SourceInfo> = {
  visitor: { id: "visitor", title: "Test campus visitor parking", url: "https://example.edu/parking", kind: "official", retrieved: "2026-10-12", reviewBy: "2026-11-12" },
};

function rules(code: string, kind: "permit-only" | "visitor-pay" | "unclear", extra: Partial<ParkingPlaceRules> = {}): ParkingPlaceRules {
  const permit = { id: `${code}-your-permit`, windows: [{ days: [...ALL], start: 0, end: 1440 }], audience: "permit" as const, access: "free" as const, sourceId: "user-permit", label: "Your permit (as entered)" };
  const other =
    kind === "visitor-pay"
      ? [{ id: `${code}-visitor`, windows: [{ days: [...ALL], start: 0, end: 1440 }], audience: "any" as const, access: "pay" as const, rate: { kind: "flat" as const, price: 4 }, sourceId: "visitor", label: "Pay at exit" }]
      : kind === "unclear"
        ? [{ id: `${code}-unclear`, windows: [{ days: [...ALL], start: 0, end: 1440 }], audience: "any" as const, access: "unknown" as const, sourceId: "visitor", note: "Weekend rules not published" }]
        : [];
  return { placeId: `t-${code}`, code, rules: [permit, ...other], overrides: [], reviewBy: "2026-11-12", ...extra };
}

/** A parking place checked for this arrival: drive, buffer, search and walk as the planner would give them. */
function check(code: string, r: ParkingPlaceRules | null, o: { driveMin?: number | null; walkMin?: number; kind?: "deck" | "lot"; permits?: string[]; occupancy?: OccupancyEvidence } = {}): ParkingCheckInput {
  const driveS = o.driveMin === null ? null : (o.driveMin ?? 20) * 60;
  const walkS = (o.walkMin ?? 5) * 60;
  const search = o.kind === "lot" ? 7 : 5;
  const arriveAt = DEADLINE - (walkS * 1000 + search * MIN);
  return {
    placeId: `t-${code}`,
    code,
    name: `Test ${code}`,
    kind: o.kind ?? "deck",
    payment: null,
    driveS,
    bufferMin: 8,
    searchMin: search,
    walkS,
    arriveAt,
    rules: r,
    evaluation: r ? evaluateNow(r, { permits: o.permits ?? [], registered: null }, arriveAt) : null,
    occupancy: o.occupancy ?? { kind: "none" },
  };
}

/** A drive option through one place, built the way the planner builds it (legs + buffer end at the deadline). */
function drive(code: string, driveMin = 20, walkMin = 5, bufferMin = 8, search = 5): ArrivalOptionInput {
  const total = driveMin + bufferMin + search + walkMin;
  return {
    id: `drive:t-${code}`,
    kind: "drive",
    title: `Drive · park at Test ${code}`,
    leaveAt: DEADLINE - total * MIN,
    arriveAt: DEADLINE,
    bufferMin,
    walkMin,
    waitMin: 0,
    rides: 0,
    costUsd: 4,
    costNote: "Parking $4",
    legs: [
      { kind: "drive", from: "Start", to: `Test ${code}`, minutes: driveMin, parkingPlaceId: `t-${code}` },
      { kind: "park", from: `Test ${code}`, to: `Test ${code}`, minutes: search, parkingPlaceId: `t-${code}` },
      { kind: "walk", from: `Test ${code}`, to: "Test Hall", minutes: walkMin },
    ],
    parking: { placeId: `t-${code}`, status: "allowed", price: null, reason: "ok", usableUntil: null },
    scheduled: false,
    access: "not_applicable",
    accessNote: null,
    notes: [],
  };
}

function transit(leaveMinBefore = 50, bufferMin = 6): ArrivalOptionInput {
  // walk 6, wait 4, ride 25, walk 5 = 40 min of legs; arrives 4 min early with the allowance.
  const leaveAt = DEADLINE - leaveMinBefore * MIN;
  return {
    id: "transit:10",
    kind: "transit",
    title: "10",
    leaveAt,
    arriveAt: leaveAt + (40 + bufferMin) * MIN,
    bufferMin,
    walkMin: 11,
    waitMin: 4,
    rides: 1,
    costUsd: 2.5,
    costNote: "Fare $2.50",
    legs: [
      { kind: "walk", from: "Start", to: "Stop A", minutes: 6 },
      { kind: "wait", from: "Stop A", to: "Stop A", minutes: 4 },
      { kind: "ride", from: "Stop A", to: "Stop B", minutes: 25, route: { short: "10", agency: "Test Transit" } },
      { kind: "walk", from: "Stop B", to: "Test Hall", minutes: 5 },
    ],
    parking: null,
    scheduled: true,
    access: "unverified",
    accessNote: "Test Transit does not publish step-free access for every stop",
    notes: [],
  };
}

function walk(minutes = 70): ArrivalOptionInput {
  return { id: "walk", kind: "walk", title: "Walk", leaveAt: DEADLINE - minutes * MIN, arriveAt: DEADLINE, bufferMin: 0, walkMin: minutes, waitMin: 0, rides: 0, costUsd: 0, costNote: "Free", legs: [{ kind: "walk", from: "Start", to: "Test Hall", minutes }], parking: null, scheduled: false, access: "not_applicable", accessNote: null, notes: [] };
}

const ENTRANCE = describeEntrance({ lon: -84.39, lat: 33.77, kind: "main", wheelchair: null, label: null }, [-84.39, 33.77], "2026-10-13");

function input(o: Partial<ArrivalPlanInput> = {}): ArrivalPlanInput {
  return {
    now: NOW,
    deadline: DEADLINE,
    destination: { label: "Test Hall", buildingId: "w1", entrance: ENTRANCE },
    options: [],
    prefer: "best",
    parking: null,
    sources: SOURCES,
    vehicle: { hasCar: true, permits: [] },
    campusCodes: ["A1", "B2", "C3"],
    campusName: "Test Campus",
    accessible: false,
    peak: true,
    weatherAvailable: true,
    rideshare: { driveMin: 22 },
    late: null,
    unavailable: [],
    ...o,
  };
}

describe("arrival plan: departure time", () => {
  it("produces a plan for a valid destination and arrival time", () => {
    const plan = buildArrivalPlan(input({ options: [drive("A1"), transit()], parking: [check("A1", rules("A1", "visitor-pay"))] }));
    expect(plan.status).toBe("ok");
    expect(plan.primary?.optionId).toBe("drive:t-A1");
    expect(plan.primary!.window.leaveBy).toBe(DEADLINE - 38 * MIN);
    expect(plan.deadline).toBe(DEADLINE);
    expect(plan.destination.entrance?.label).toBe("Main entrance");
  });

  it("subtracts every part once: drive + buffer + finding a space + walk = deadline − leave-by", () => {
    const o = drive("A1", 20, 6, 8, 5);
    const comps = arrivalComponents(o, { parkingKind: "deck", peak: true });
    expect(comps.map((c) => c.kind)).toEqual(["drive", "park_search", "walk"]);
    const total = sumRange(comps);
    // High end: 20 + 8 buffer, 5 search, 6 walk = 39 = what the option plans for.
    expect(total.high).toBe(39);
    expect(total.high).toBe((o.arriveAt - o.leaveAt) / MIN);
    // Low end: clear roads and a quick space.
    expect(total.low).toBe(20 + 2 + 6);
    const w = leaveWindow(o, comps, DEADLINE);
    expect(w.leaveBy).toBe(DEADLINE - 39 * MIN);
    expect(w.latestIfSmooth).toBe(DEADLINE - 28 * MIN);
    expect(w.arrive).toEqual([DEADLINE - 11 * MIN, DEADLINE]);
    expect(w.total).toEqual({ low: 28, high: 39 });
  });

  it("keeps a transit departure fixed by the timetable and the delay allowance as one part", () => {
    const o = transit(50, 6);
    const comps = arrivalComponents(o);
    expect(comps.map((c) => c.kind)).toEqual(["walk_to_stop", "wait", "ride", "walk", "delay_allowance"]);
    expect(sumRange(comps)).toEqual({ low: 40, high: 46 });
    const w = leaveWindow(o, comps, DEADLINE);
    expect(w.fixedBy).toBe("timetable");
    expect(w.latestIfSmooth).toBeNull();
    expect(w.spareMin).toBe(4);
    expect(comps.find((c) => c.kind === "ride")!.provenance.status).toBe("official");
  });

  it("never shows more precision than a minute", () => {
    const o = { ...drive("A1"), leaveAt: DEADLINE - 38 * MIN - 25_000 };
    const w = leaveWindow(o, arrivalComponents(o, { parkingKind: "deck" }), DEADLINE);
    expect(w.leaveBy % MIN).toBe(0);
    expect(w.leaveBy).toBeLessThanOrEqual(o.leaveAt);
  });
});

describe("arrival plan: permit-aware parking", () => {
  it("excludes a lot the selected permit doesn't allow", () => {
    const a1 = check("A1", rules("A1", "permit-only"), { walkMin: 3 });
    const b2 = check("B2", rules("B2", "permit-only"), { walkMin: 6, permits: ["B2"] });
    const [x, y] = assessParking([a1, b2], { now: NOW, deadline: DEADLINE, sources: SOURCES });
    expect(x!.verdict).toBe("restricted");
    expect(x!.reason).toBe("Permit required");
    expect(y!.verdict).toBe("eligible");
    expect(y!.access).toBe("your_permit");
    expect(y!.rules.status).toBe("user");
    const plan = buildArrivalPlan(input({ options: [drive("B2", 20, 6)], parking: [a1, b2], vehicle: { hasCar: true, permits: ["B2"] } }));
    expect(plan.parking!.primary!.placeId).toBe("t-B2");
    expect(plan.parking!.places.find((p) => p.placeId === "t-A1")!.verdict).toBe("restricted");
    // The nearest lot could not be used, and the plan says why.
    expect(plan.parking!.firstChoiceIssue).toMatchObject({ name: "Test A1", verdict: "restricted" });
  });

  it("prefers your permit's place over paying, unless paying saves real time", () => {
    const yours = check("B2", rules("B2", "visitor-pay"), { walkMin: 8, permits: ["B2"] });
    const near = check("A1", rules("A1", "visitor-pay"), { walkMin: 5, permits: ["B2"] });
    const [x, y] = assessParking([near, yours], { now: NOW, deadline: DEADLINE, sources: SOURCES });
    expect(chooseParking([x!, y!], { permits: { matched: ["B2"], unmatched: [] } }).primary!.placeId).toBe("t-B2");
    // A pay place that saves 12 minutes wins; the permit place becomes the backup.
    const far = check("B2", rules("B2", "visitor-pay"), { walkMin: 17, permits: ["B2"] });
    const [f] = assessParking([far], { now: NOW, deadline: DEADLINE, sources: SOURCES });
    const plan = chooseParking([x!, f!], { permits: { matched: ["B2"], unmatched: [] } });
    expect(plan.primary!.placeId).toBe("t-A1");
    expect(plan.backup!.placeId).toBe("t-B2");
    expect(plan.backup!.tradeoff.text).toMatch(/^Eligible for your permit, adds about 12 min of walking, leave 12 min earlier/);
  });

  it("does not treat unknown eligibility as permission", () => {
    const unclear = check("C3", rules("C3", "unclear"), { walkMin: 2 });
    const noRecord = check("D4", null, { walkMin: 1 });
    const expired = check("A1", rules("A1", "visitor-pay", { reviewBy: "2026-10-01" }), { walkMin: 3 });
    const assessed = assessParking([unclear, noRecord, expired], { now: NOW, deadline: DEADLINE, sources: SOURCES });
    expect(assessed.map((a) => a.verdict)).toEqual(["uncertain", "uncertain", "uncertain"]);
    expect(assessed[2]!.reason).toBe("Rules need re-checking");
    const plan = chooseParking(assessed, { permits: { matched: [], unmatched: [] } });
    expect(plan.primary).toBeNull();
    expect(plan.backup).toBeNull();
    expect(plan.emptyReason).toMatch(/aren't published or need re-checking/);
  });

  it("treats a permit that matches no known place as no permit, and says so", () => {
    expect(permitMatch(["z99", "B2", " b2 "], ["A1", "B2"])).toEqual({ matched: ["B2"], unmatched: ["Z99"] });
    const plan = buildArrivalPlan(input({ options: [drive("A1")], parking: [check("A1", rules("A1", "visitor-pay"), { permits: ["Z99"] })], vehicle: { hasCar: true, permits: ["Z99"] } }));
    expect(plan.notices[0]).toMatch(/Z99 doesn't match a parking place .* treated as no permit/);
    expect(plan.parking!.primary!.access).toBe("pay");
  });

  it("shows the rule's source and the date it was verified", () => {
    const [a] = assessParking([check("A1", rules("A1", "visitor-pay"))], { now: NOW, deadline: DEADLINE, sources: SOURCES });
    expect(a!.rules).toMatchObject({ status: "official", label: "Test campus visitor parking", retrieved: "2026-10-12", reviewBy: "2026-11-12", url: "https://example.edu/parking" });
  });
});

describe("arrival plan: backup", () => {
  it("moves to a viable backup when the first-choice lot is unavailable", () => {
    const closedRules = rules("A1", "visitor-pay", { overrides: [{ id: "event", start: NOW, end: DEADLINE + 3600_000, effect: "closed", label: "Test event", sourceId: "visitor" }] });
    const a1 = check("A1", closedRules, { walkMin: 3 });
    const b2 = check("B2", rules("B2", "visitor-pay"), { walkMin: 8 });
    const c3 = check("C3", rules("C3", "visitor-pay"), { walkMin: 11 });
    const plan = buildArrivalPlan(input({ options: [drive("A1", 20, 3), drive("B2", 20, 8), drive("C3", 20, 11), transit()], parking: [a1, b2, c3] }));
    expect(plan.parking!.places.find((p) => p.placeId === "t-A1")!.verdict).toBe("closed");
    expect(plan.primary!.optionId).toBe("drive:t-B2");
    expect(plan.parking!.firstChoiceIssue).toMatchObject({ name: "Test A1", verdict: "closed" });
    expect(plan.backup).toMatchObject({ kind: "place", placeId: "t-C3", optionId: "drive:t-C3" });
    expect(plan.backup.text).toMatch(/Pay to park, adds about 3 min of walking, leave 3 min earlier\. Availability has not been verified\./);
  });

  it("uses community 'full' reports to skip a lot, labelled as unverified reports", () => {
    const full: OccupancyEvidence = { kind: "community", state: "full", reports: 2, latestAt: NOW - 3 * MIN };
    const plan = buildArrivalPlan(input({ options: [drive("A1", 20, 3), drive("B2", 20, 8)], parking: [check("A1", rules("A1", "visitor-pay"), { walkMin: 3, occupancy: full }), check("B2", rules("B2", "visitor-pay"), { walkMin: 8 })] }));
    const a1 = plan.parking!.places.find((p) => p.placeId === "t-A1")!;
    expect(a1.verdict).toBe("full");
    expect(a1.occupancy.provenance.status).toBe("community");
    expect(a1.occupancy.label).toMatch(/not verified/);
    expect(plan.parking!.primary!.placeId).toBe("t-B2");
  });

  it("falls back to another way to arrive when no other lot is eligible", () => {
    const plan = buildArrivalPlan(input({ options: [drive("A1"), transit()], parking: [check("A1", rules("A1", "visitor-pay"))] }));
    expect(plan.parking!.backup).toBeNull();
    expect(plan.backup).toMatchObject({ kind: "option", optionId: "transit:10", mode: "transit" });
    expect(plan.backup.text).toMatch(/^No other eligible parking nearby\./);
  });

  it("switches away from driving when no parking can be used, and never invents a lot", () => {
    const plan = buildArrivalPlan(input({ options: [drive("A1"), transit()], parking: [check("A1", rules("A1", "permit-only"))] }));
    expect(plan.parking!.primary).toBeNull();
    expect(plan.primary!.kind).toBe("transit");
    expect(plan.notices.join(" ")).toMatch(/Driving isn't recommended/);
    expect(plan.comparison.some((r) => r.kind === "drive")).toBe(false);
  });

  it("says plainly when there is no verified alternative", () => {
    const plan = buildArrivalPlan(input({ options: [walk()], rideshare: null }));
    expect(plan.backup.kind).toBe("none");
    expect(plan.confidence.reasons.join(" ")).toMatch(/no verified backup/);
  });
});

describe("arrival plan: honesty about missing data", () => {
  it("never turns missing occupancy data into an availability claim", () => {
    const [a] = assessParking([check("A1", rules("A1", "visitor-pay"))], { now: NOW, deadline: DEADLINE, sources: SOURCES });
    expect(a!.occupancy).toMatchObject({ full: false, label: "Availability not verified", provenance: { status: "unknown" } });
    const plan = buildArrivalPlan(input({ options: [drive("A1")], parking: [check("A1", rules("A1", "visitor-pay"))] }));
    expect(plan.confidence.reasons).toContain("Space availability isn't published, so a space isn't guaranteed.");
    expect(plan.confidence.level).not.toBe("steady");
  });

  it("states that a step-free route can't be confirmed, whatever the map says", () => {
    const yes = describeEntrance({ lon: 0, lat: 0, kind: "door", wheelchair: "yes", label: null }, [0, 0], null);
    const plan = buildArrivalPlan(input({ accessible: true, destination: { label: "Test Hall", buildingId: "w1", entrance: yes }, options: [walk(20)] }));
    expect(plan.access.status).toBe("unconfirmed");
    expect(plan.access.summary).toMatch(/can't confirm a complete step-free route/);
    expect(plan.access.mapped[0]).toMatch(/community data, not confirmed/);
    expect(plan.access.gaps.join(" ")).toMatch(/curb ramps/);
    const none = buildArrivalPlan(input({ accessible: true, destination: { label: "X", buildingId: null, entrance: describeEntrance(null, [0, 0], null) }, options: [walk(20)] }));
    expect(none.access.gaps[0]).toMatch(/No entrance is mapped/);
    expect(buildArrivalPlan(input({ options: [walk(20)] })).access.status).toBe("not_requested");
  });

  it("chooses a step-free entrance when asked, else a main entrance", () => {
    const es = [
      { lon: 1, lat: 1, kind: "door" as const, wheelchair: null, label: null },
      { lon: 2, lat: 2, kind: "main" as const, wheelchair: "no" as const, label: null },
      { lon: 3, lat: 3, kind: "door" as const, wheelchair: "yes" as const, label: null },
    ];
    expect(pickEntrance(es, { accessible: true })!.lon).toBe(3);
    expect(pickEntrance(es, { accessible: false })!.lon).toBe(2);
    expect(pickEntrance([], { accessible: false })).toBeNull();
  });

  it("degrades gracefully when routing or transit is missing", () => {
    // Driving could not be routed and transit produced nothing: no option, no false success.
    const plan = buildArrivalPlan(input({ options: [], parking: [check("A1", rules("A1", "visitor-pay"), { driveMin: null })], unavailable: [{ kind: "transit", reason: "No timetabled transit serves both places" }], rideshare: null }));
    expect(plan.status).toBe("no_options");
    expect(plan.primary).toBeNull();
    expect(plan.parking!.places[0]!.verdict).toBe("unavailable");
    expect(plan.parking!.emptyReason).toBe("Driving times couldn't be calculated right now.");
    // A preferred mode with no option is reported, with the reason, and another way is shown.
    const pref = buildArrivalPlan(input({ prefer: "transit", options: [walk(40)], unavailable: [{ kind: "transit", reason: "No timetabled transit serves both places." }] }));
    expect(pref.primary!.kind).toBe("walk");
    expect(pref.notices[0]).toBe("Transit can't get you there by the time you chose (No timetabled transit serves both places). Showing the best other way.");
  });

  it("reports the earliest arrival when nothing arrives in time", () => {
    const late = { ...transit(), leaveAt: NOW, arriveAt: DEADLINE + 12 * MIN };
    const plan = buildArrivalPlan(input({ options: [], late: { option: late, lateMin: 12 } }));
    expect(plan.status).toBe("late");
    expect(plan.late).toEqual({ optionId: "transit:10", arriveAt: DEADLINE + 12 * MIN, lateMin: 12 });
  });

  it("compares one best option per way of travelling against the plan", () => {
    const plan = buildArrivalPlan(input({ options: [drive("A1"), drive("B2", 25, 8), transit(), walk()], parking: [check("A1", rules("A1", "visitor-pay")), check("B2", rules("B2", "visitor-pay"), { walkMin: 8, driveMin: 25 })] }));
    expect(plan.comparison.map((r) => r.kind)).toEqual(["drive", "transit", "walk"]);
    expect(plan.comparison[0]).toMatchObject({ chosen: true, versus: "This plan" });
    expect(plan.comparison[1]!.versus).toMatch(/^Leave 12 min earlier · no parking needed/);
    expect(plan.comparison[2]!.versus).toMatch(/^Leave 32 min earlier/);
  });

  it("explains confidence in words, without a score", () => {
    const plan = buildArrivalPlan(input({ options: [transit()], transitStatus: "calendar_unconfirmed" }));
    expect(plan.confidence.level).toBe("uncertain");
    expect(plan.confidence.headline).toBe("Check before you leave");
    expect(plan.confidence.extraMin).toBe(10);
    expect(JSON.stringify(plan.confidence)).not.toMatch(/\d+%/);
  });
});
