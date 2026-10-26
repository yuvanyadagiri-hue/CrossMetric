import { describe, expect, it } from "vitest";
import { chooseOptions, driveBufferMin, isPeak, leaveInstruction, transitBufferMin, type TripOption } from "../src/commute/arrive";
import { allocatedPermitCost, formatUsd, marginalTripCost } from "../src/commute/costs";
import { dueEntries, materialChange, outboxKey, planVersion, reconcileOutbox, remindersFor, type PlanSnapshot } from "../src/commute/reminders";
import { dailyTargets, dedupeOccurrences, expandManual, isRemoteLocation, nextClass, plannable, resolveBuilding, type BuildingRef, type ClassOccurrence } from "../src/commute/schedule";
import { zonedToUtc } from "../src/commute/time";
import { categorizeIntensity, parseNwsInterval, rainStateFor, rainWalk } from "../src/commute/weather";

const at = (date: string, time: string) => {
  const [h, m] = time.split(":").map(Number);
  return zonedToUtc(date, h! * 60 + m!);
};
const MIN = 60_000;

describe("schedules", () => {
  it("expands a manual MWF class with local times across the DST change", () => {
    const occ = expandManual({ id: "c1", campus: "gt", buildingId: "w1", days: [1, 3, 5], start: "09:00", end: "09:50", from: "2026-10-26", until: "2026-11-06", skip: ["2026-10-30"] }, "2026-10-26", "2026-11-06");
    expect(occ.map((o) => o.date)).toEqual(["2026-10-26", "2026-10-28", "2026-11-02", "2026-11-04", "2026-11-06"]);
    // 9:00 local is 13:00Z before Nov 1 and 14:00Z after.
    expect(new Date(occ[0]!.start).toISOString()).toBe("2026-10-26T13:00:00.000Z");
    expect(new Date(occ[2]!.start).toISOString()).toBe("2026-11-02T14:00:00.000Z");
    expect(new Set(occ.map((o) => o.key)).size).toBe(occ.length);
  });

  const occ = (p: Partial<ClassOccurrence>): ClassOccurrence => ({
    key: Math.random().toString(36),
    source: "ics",
    sourceRef: "u",
    start: at("2026-10-13", "09:00"),
    end: at("2026-10-13", "09:50"),
    date: "2026-10-13",
    buildingId: "w1",
    status: "confirmed",
    allDay: false,
    remote: false,
    include: null,
    needsLocation: false,
    ...p,
  });

  it("does not plan cancelled, all-day, remote or unresolved events unless explicitly included", () => {
    expect(plannable(occ({ status: "cancelled" }))).toBe(false);
    expect(plannable(occ({ allDay: true }))).toBe(false);
    expect(plannable(occ({ remote: true }))).toBe(false);
    expect(plannable(occ({ needsLocation: true }))).toBe(false);
    expect(plannable(occ({ remote: true, include: true }))).toBe(true);
    expect(plannable(occ({ buildingId: null, include: true }))).toBe(false);
  });

  it("drops an imported duplicate of a manual class and keeps one occurrence identity", () => {
    const m = occ({ key: "manual|c1|2026-10-13", source: "manual" });
    const dup = occ({ key: "ics|abc|20261013T130000Z" });
    const again = occ({ key: "manual|c1|2026-10-13", source: "manual" });
    expect(dedupeOccurrences([dup, m, again]).map((o) => o.key)).toEqual(["manual|c1|2026-10-13"]);
  });

  it("targets the first in-person class each day and flags overlaps", () => {
    const a = occ({ key: "a", start: at("2026-10-13", "09:00"), end: at("2026-10-13", "10:15") });
    const b = occ({ key: "b", start: at("2026-10-13", "09:30"), end: at("2026-10-13", "10:45") });
    const c = occ({ key: "c", start: at("2026-10-13", "13:00"), end: at("2026-10-13", "14:00") });
    const remote = occ({ key: "r", start: at("2026-10-13", "08:00"), end: at("2026-10-13", "08:50"), remote: true });
    const [t] = dailyTargets([c, b, remote, a]);
    expect(t!.first.key).toBe("a");
    expect(t!.overlaps.map((o) => o.key)).toEqual(["b"]);
    expect(t!.later.map((o) => o.key)).toEqual(["c"]);
    expect(nextClass([a, c], at("2026-10-13", "10:00"))!.key).toBe("c");
  });

  const buildings: BuildingRef[] = [
    { id: "klaus", name: "Klaus Advanced Computing Building", aliases: ["Klaus"] },
    { id: "culc", name: "Clough Undergraduate Learning Commons", aliases: ["CULC"] },
    { id: "howey", name: "Howey Physics Building", aliases: [] },
    { id: "boggs", name: "Boggs Building", aliases: [] },
    { id: "mrdc", name: "Manufacturing Related Disciplines Complex", aliases: ["MRDC"] },
    { id: "mrdc2", name: "MRDC II", aliases: [] },
    { id: "enga", name: "Engineering Building A", aliases: [] },
    { id: "engb", name: "Engineering Building B", aliases: [] },
  ];

  it("matches class locations to campus buildings, and asks when ambiguous", () => {
    expect(resolveBuilding("Klaus 1443", buildings)).toMatchObject({ status: "likely", matches: [{ id: "klaus" }] });
    expect(resolveBuilding("Clough Undergraduate Learning Commons 144", buildings)).toMatchObject({ status: "likely", matches: [{ id: "culc" }] });
    expect(resolveBuilding("CULC", buildings)).toMatchObject({ status: "exact", matches: [{ id: "culc" }] });
    expect(resolveBuilding("Howey L3", buildings).matches[0]!.id).toBe("howey");
    expect(resolveBuilding("MRDC 2404", buildings)).toMatchObject({ status: "likely", matches: [{ id: "mrdc" }] });
    expect(resolveBuilding("Engineering 100", buildings)).toMatchObject({ status: "ambiguous", matches: [{ id: "enga" }, { id: "engb" }] });
    expect(resolveBuilding("Somewhere Else 100", buildings).status).toBe("none");
  });

  it("recognizes remote locations", () => {
    expect(isRemoteLocation("Online - Zoom")).toBe(true);
    expect(isRemoteLocation("Klaus 1443")).toBe(false);
  });
});

describe("arrive-by choice", () => {
  const now = at("2026-10-13", "07:30");
  const deadline = at("2026-10-13", "08:55");
  const opt = (p: Partial<TripOption>): TripOption => ({
    id: "x",
    kind: "drive",
    leaveBy: at("2026-10-13", "08:00"),
    arriveAt: deadline,
    arriveIfNow: at("2026-10-13", "08:25"),
    durationS: 40 * 60,
    bufferMin: 10,
    costUsd: 9,
    outdoorMin: 6,
    rides: 0,
    signature: "x",
    eligible: true,
    ...p,
  });

  it("recommends the latest feasible departure and keeps a distinct backup", () => {
    const drive = opt({ id: "drive", signature: "drive:W02" });
    const bus = opt({ id: "bus", kind: "transit", leaveBy: at("2026-10-13", "07:50"), costUsd: 2.5, rides: 1, signature: "transit:A", outdoorMin: 12 });
    const illegal = opt({ id: "illegal", leaveBy: at("2026-10-13", "08:20"), eligible: false, signature: "drive:N04" });
    const c = chooseOptions([bus, drive, illegal], now, deadline);
    expect(c.recommended!.id).toBe("drive");
    expect(c.cheapest!.id).toBe("bus");
    expect(c.backup!.id).toBe("bus");
    expect(c.late).toBeNull();
  });

  it("offers a less-exposed option only within the detour limit", () => {
    const drive = opt({ id: "drive", signature: "drive:W02", outdoorMin: 9 });
    const deck = opt({ id: "deck", signature: "drive:E81", leaveBy: at("2026-10-13", "07:58"), durationS: 43 * 60, outdoorMin: 2 });
    const far = opt({ id: "far", signature: "drive:W22", leaveBy: at("2026-10-13", "07:45"), durationS: 60 * 60, outdoorMin: 1 });
    expect(chooseOptions([drive, deck, far], now, deadline, { maxDetourMin: 5 }).lessExposure!.id).toBe("deck");
    expect(chooseOptions([drive, deck, far], now, deadline, { maxDetourMin: 2 }).lessExposure).toBeNull();
  });

  it("prefers a different mode as the backup over a second deck on the same drive", () => {
    const deckA = opt({ id: "a", signature: "drive:W02", costUsd: 9 });
    const deckB = opt({ id: "b", signature: "drive:W23", leaveBy: at("2026-10-13", "07:59"), costUsd: 9 });
    const cheapDeck = opt({ id: "c", signature: "drive:CUR", leaveBy: at("2026-10-13", "07:50"), costUsd: 3 });
    const bus = opt({ id: "bus", kind: "transit", signature: "transit:A", leaveBy: at("2026-10-13", "07:45"), costUsd: 5, rides: 1 });
    const c = chooseOptions([deckA, deckB, cheapDeck, bus], now, deadline);
    expect(c.recommended!.id).toBe("a");
    expect(c.cheapest!.id).toBe("c");
    expect(c.backup!.id).toBe("bus");
  });

  it("reports the earliest attainable arrival and lateness instead of shrinking buffers", () => {
    const late = opt({ leaveBy: at("2026-10-13", "07:00"), arriveIfNow: at("2026-10-13", "09:07") });
    const c = chooseOptions([late], now, deadline);
    expect(c.recommended).toBeNull();
    expect(c.late).toMatchObject({ lateMin: 12 });
  });

  it("sizes buffers transparently", () => {
    expect(driveBufferMin(40)).toBe(12);
    expect(driveBufferMin(8)).toBe(5);
    expect(driveBufferMin(20, undefined, true)).toBe(12);
    expect(driveBufferMin(10, undefined, true)).toBe(8);
    expect(isPeak(2, 8 * 60 + 30)).toBe(true);
    expect(isPeak(6, 8 * 60 + 30)).toBe(false);
    expect(isPeak(2, 12 * 60)).toBe(false);
    expect(transitBufferMin([{ headwaySec: 0 }, { headwaySec: 600 }])).toBe(3 + 10);
    expect(transitBufferMin([{ headwaySec: 3600 }])).toBe(12);
    expect(leaveInstruction(now + 8 * MIN + 5000, now)).toEqual({ kind: "soon", minutes: 8 });
    expect(leaveInstruction(now - 1000, now).kind).toBe("now");
  });
});

describe("reminders", () => {
  const plan = (p: Partial<PlanSnapshot> = {}): PlanSnapshot => ({
    occurrenceKey: "manual|c1|2026-10-13",
    classStart: at("2026-10-13", "09:00"),
    latestLeave: at("2026-10-13", "07:55"),
    version: "v1",
    late: false,
    optionSignature: "drive:W02",
    ...p,
  });

  it("alerts early enough for a long commute, not only at class minus 30", () => {
    // 9:00 class, 5-min entry buffer, 60-min commute -> leave 7:55; heads-up 7:45.
    const r = remindersFor(plan());
    expect(r).toEqual([
      { kind: "heads_up", at: at("2026-10-13", "07:45") },
      { kind: "leave_now", at: at("2026-10-13", "07:55") },
      { kind: "recheck", at: at("2026-10-13", "08:30") },
    ]);
  });

  it("is idempotent across repeated webhooks and plan versions", () => {
    let box = reconcileOutbox([], [{ plan: plan(), reminders: remindersFor(plan()) }], "inapp", new Set([plan().occurrenceKey]));
    box = reconcileOutbox(box, [{ plan: plan(), reminders: remindersFor(plan()) }], "inapp", new Set([plan().occurrenceKey]));
    expect(box.filter((e) => e.kind === "leave_now")).toHaveLength(1);
    const moved = plan({ latestLeave: at("2026-10-13", "07:50"), version: "v2" });
    box = reconcileOutbox(box, [{ plan: moved, reminders: remindersFor(moved) }], "inapp", new Set([moved.occurrenceKey]));
    const leave = box.find((e) => e.key === outboxKey(moved.occurrenceKey, "leave_now", "inapp"))!;
    expect(leave).toMatchObject({ at: at("2026-10-13", "07:50"), version: "v2", status: "pending" });
    expect(box).toHaveLength(3);
  });

  it("cancels jobs for a cancelled or moved class and never resends a sent reminder", () => {
    let box = reconcileOutbox([], [{ plan: plan(), reminders: remindersFor(plan()) }], "inapp", new Set([plan().occurrenceKey]));
    box = box.map((e) => (e.kind === "heads_up" ? { ...e, status: "sent" as const, sentAt: at("2026-10-13", "07:45") } : e));
    box = reconcileOutbox(box, [{ plan: plan({ version: "v3" }), reminders: remindersFor(plan()) }], "inapp", new Set([plan().occurrenceKey]));
    expect(box.find((e) => e.kind === "heads_up")!.status).toBe("sent");
    box = reconcileOutbox(box, [], "inapp", new Set());
    expect(box.filter((e) => e.status === "pending")).toHaveLength(0);
  });

  it("sends one current instruction instead of a burst of past-due alerts", () => {
    const p = plan();
    const box = reconcileOutbox([], [{ plan: p, reminders: remindersFor(p) }], "inapp", new Set([p.occurrenceKey]));
    const { send, drop } = dueEntries(box, { now: at("2026-10-13", "08:00"), plans: new Map([[p.occurrenceKey, p]]), started: new Set() });
    expect(send.map((e) => e.kind)).toEqual(["leave_now"]);
    expect(drop.map((e) => e.kind)).toEqual(["heads_up"]);
  });

  it("drops stale versions, started trips and quiet hours", () => {
    const p = plan();
    const box = reconcileOutbox([], [{ plan: p, reminders: remindersFor(p) }], "inapp", new Set([p.occurrenceKey]));
    const now = at("2026-10-13", "07:56");
    expect(dueEntries(box, { now, plans: new Map([[p.occurrenceKey, { ...p, version: "v9" }]]), started: new Set() }).send).toHaveLength(0);
    expect(dueEntries(box, { now, plans: new Map([[p.occurrenceKey, p]]), started: new Set([p.occurrenceKey]) }).send).toHaveLength(0);
    expect(dueEntries(box, { now, plans: new Map([[p.occurrenceKey, p]]), started: new Set(), localMinute: 7 * 60 + 56, prefs: { prepMin: 10, classCheckMin: 30, materialMin: 3, cooldownMin: 10, quietStart: 22 * 60, quietEnd: 8 * 60 } }).send).toHaveLength(0);
  });

  it("flags material changes with a cooldown, letting new disruptions through", () => {
    const a = plan();
    const b = plan({ latestLeave: a.latestLeave - 4 * MIN, version: "v2" });
    const now = at("2026-10-13", "07:30");
    expect(materialChange(a, b, null, now)).toBe(true);
    expect(materialChange(a, plan({ latestLeave: a.latestLeave - 2 * MIN }), null, now)).toBe(false);
    expect(materialChange(a, b, now - 5 * MIN, now)).toBe(false);
    expect(materialChange(a, b, now - 5 * MIN, now, undefined, true)).toBe(true);
    expect(materialChange(a, plan({ late: true }), null, now)).toBe(true);
    expect(planVersion([1, "a"])).toBe(planVersion([1, "a"]));
    expect(planVersion([1, "a"])).not.toBe(planVersion([1, "b"]));
  });
});

describe("weather walking penalty", () => {
  it("buckets intensity and never infers rain from nothing", () => {
    expect(categorizeIntensity(0)).toBe("dry");
    expect(categorizeIntensity(1)).toBe("light");
    expect(categorizeIntensity(2.5)).toBe("moderate");
    expect(categorizeIntensity(8)).toBe("heavy");
    expect(rainStateFor([], [], 0, 1).state).toBe("unavailable");
  });

  it("uses average interval intensity from NWS quantitative precipitation", () => {
    const iv = parseNwsInterval("2026-10-13T12:00:00+00:00/PT3H")!;
    expect(iv.end - iv.start).toBe(3 * 3_600_000);
    const qpf = [{ ...iv, value: 9 }]; // 9 mm over 3 h = 3 mm/h average
    const s = rainStateFor(qpf, [], iv.start + 60_000, iv.start + 20 * MIN);
    expect(s).toMatchObject({ state: "moderate", avgMmPerHour: 3 });
    expect(rainStateFor([], [{ ...iv, value: 70 }], iv.start, iv.start + MIN).state).toBe("wet_unknown_intensity");
  });

  it("applies the penalty to exposed walking only, treating unknown cover as exposed", () => {
    const edges = [
      { baselineMin: 10, coveredFraction: null },
      { baselineMin: 5, coveredFraction: 1 },
    ];
    const r = rainWalk(edges, "heavy", 3);
    expect(r.adjustedMin).toBeCloseTo(17);
    expect(r.badgeMin).toBe(2);
    expect(r.exposureMin).toBeCloseTo(12 + 3);
    expect(rainWalk(edges, "dry").badgeMin).toBeNull();
    expect(rainWalk(edges, "unavailable").adjustedMin).toBeNull();
    const range = rainWalk(edges, "wet_unknown_intensity").range!;
    expect(range[0]).toBeCloseTo(15.5);
    expect(range[1]).toBeCloseTo(16.2);
  });
});

describe("costs", () => {
  it("keeps unknown inputs unknown and separates allocated permit cost", () => {
    const known = marginalTripCost({ drivenMiles: 12, mpg: 30, fuelPricePerGallon: 3, parkingUsd: 9, transitFaresUsd: 0 });
    expect(known.fuel).toBe(2.4);
    expect(known.total).toBe(11.4);
    const unknown = marginalTripCost({ drivenMiles: 12, mpg: null, fuelPricePerGallon: 3, parkingUsd: null, transitFaresUsd: 0 });
    expect(unknown.total).toBeNull();
    expect(unknown.missing).toEqual(["mpg", "parking price"]);
    expect(marginalTripCost({ drivenMiles: 0, mpg: null, fuelPricePerGallon: null, parkingUsd: 0, transitFaresUsd: 5 }).total).toBe(5);
    expect(allocatedPermitCost(10, 20)).toBe(0.5);
    expect(allocatedPermitCost(10, 0)).toBeNull();
    expect(formatUsd(null)).toBe("Cost unknown");
    expect(formatUsd(0)).toBe("$0");
    expect(formatUsd(2.5)).toBe("$2.50");
    expect(formatUsd(15)).toBe("$15");
  });
});
