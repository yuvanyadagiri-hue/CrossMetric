import { describe, expect, it } from "vitest";
import { parseTripIntent, expandPlaceAlias } from "../src/commute/intent";
import { applyConstraints, DEFAULT_TRAVEL_PREFERENCES, rankOptions, toleranceFor, type RankOption, type TravelPreferences } from "../src/commute/rank";
import { localDate, zonedToUtc } from "../src/commute/time";
import {
  checkTiming,
  dayWord,
  instantToLocalInputs,
  LEAVE_NOW,
  localInputsToInstant,
  resultFreshness,
  suggestedTime,
  timingInstant,
  timingKey,
  timingLabel,
} from "../src/commute/timing";

const MIN = 60_000;
const at = (date: string, time: string) => {
  const [h, m] = time.split(":").map(Number);
  return zonedToUtc(date, h! * 60 + m!);
};

describe("trip timing (regression: routes must not silently move to tomorrow)", () => {
  // 11:40 PM in Atlanta on Tue Oct 13 2026 is 03:40Z on Oct 14: a UTC-based device thinks it is already "tomorrow".
  const lateNight = at("2026-10-13", "23:40");

  it("a new search defaults to leave now, anchored at the current instant", () => {
    expect(LEAVE_NOW).toEqual({ mode: "now" });
    expect(timingInstant(LEAVE_NOW, lateNight)).toBe(lateNight);
    expect(timingLabel(LEAVE_NOW, lateNight)).toBe("Leave now");
    expect(checkTiming(LEAVE_NOW, lateNight)).toEqual({ ok: true, timing: { mode: "now" } });
  });

  it("keeps an explicit future departure exactly as chosen", () => {
    const now = at("2026-10-13", "15:00");
    const depart = at("2026-10-15", "08:10");
    const check = checkTiming({ mode: "depart", at: depart }, now);
    expect(check).toEqual({ ok: true, timing: { mode: "depart", at: depart } });
    expect(timingLabel({ mode: "depart", at: depart }, now)).toBe("Depart Thu, Oct 15 8:10 AM");
    expect(timingLabel({ mode: "depart", at: at("2026-10-13", "17:20") }, now)).toBe("Depart today 5:20 PM");
  });

  it("keeps an arrival deadline and labels it relative to today", () => {
    const now = at("2026-10-13", "15:00");
    const by = at("2026-10-14", "09:00");
    expect(checkTiming({ mode: "arrive", by }, now)).toEqual({ ok: true, timing: { mode: "arrive", by } });
    expect(timingLabel({ mode: "arrive", by }, now)).toBe("Arrive by Tomorrow 9:00 AM");
  });

  it("rejects a time that has passed instead of rolling it over to tomorrow", () => {
    const now = at("2026-10-13", "10:00");
    const nineToday = at("2026-10-13", "09:00");
    const r = checkTiming({ mode: "arrive", by: nineToday }, now);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problem).toBe("past");
      expect(r.message).toMatch(/passed/);
    }
    // A few minutes of slack while the form is filled in.
    expect(checkTiming({ mode: "depart", at: now - 2 * MIN }, now).ok).toBe(true);
    expect(checkTiming({ mode: "depart", at: Number.NaN }, now).ok).toBe(false);
    expect(checkTiming({ mode: "depart", at: now + 400 * 86_400_000 }, now).ok).toBe(false);
  });

  it("converts Georgia wall-clock inputs to instants whatever the device time zone", () => {
    const r = localInputsToInstant("2026-10-14", "09:00");
    expect(r).toEqual({ at: Date.parse("2026-10-14T13:00:00Z"), status: "exact" });
    // Winter time: 9:00 EST is 14:00Z.
    expect(localInputsToInstant("2026-12-01", "09:00")!.at).toBe(Date.parse("2026-12-01T14:00:00Z"));
    expect(instantToLocalInputs(lateNight)).toEqual({ date: "2026-10-13", time: "23:40" });
    expect(localInputsToInstant("2026-10-14", "25:00")).toBeNull();
    expect(localInputsToInstant("10/14/2026", "09:00")).toBeNull();
  });

  it("handles daylight-saving changes explicitly", () => {
    // Spring forward 2027-03-14: 2:30 AM does not exist.
    const skipped = localInputsToInstant("2027-03-14", "02:30")!;
    expect(skipped.status).toBe("skipped");
    expect(instantToLocalInputs(skipped.at)).toEqual({ date: "2027-03-14", time: "03:30" });
    // Fall back 2026-11-01: 1:30 AM happens twice; the first (EDT) is used.
    const twice = localInputsToInstant("2026-11-01", "01:30")!;
    expect(twice.status).toBe("ambiguous");
    expect(twice.at).toBe(Date.parse("2026-11-01T05:30:00Z"));
  });

  it("labels days around midnight in Georgia time, not device time", () => {
    expect(localDate(lateNight)).toBe("2026-10-13");
    expect(dayWord(at("2026-10-14", "00:15"), lateNight)).toBe("Tomorrow");
    expect(dayWord(at("2026-10-13", "23:59"), lateNight)).toBe("Today");
  });

  it("suggests a starting time in the future, never the past", () => {
    const now = at("2026-10-13", "23:52");
    const s = suggestedTime(now);
    expect(s).toBeGreaterThan(now);
    expect(instantToLocalInputs(s)).toEqual({ date: "2026-10-14", time: "00:10" });
  });

  it("gives different keys to different times so results are never reused for another time", () => {
    const now = at("2026-10-13", "12:00");
    expect(timingKey(LEAVE_NOW)).toBe("now");
    expect(timingKey({ mode: "depart", at: now })).not.toBe(timingKey({ mode: "arrive", by: now }));
    expect(timingKey({ mode: "depart", at: now })).not.toBe(timingKey({ mode: "depart", at: now + 5 * MIN }));
    expect(timingKey({ mode: "depart", at: now })).toBe(timingKey({ mode: "depart", at: now + 10_000 }));
  });

  it("treats an old leave-now result as stale and a passed departure as past", () => {
    const t0 = at("2026-10-13", "12:00");
    expect(resultFreshness(LEAVE_NOW, t0, t0 + 2 * MIN)).toBe("fresh");
    expect(resultFreshness(LEAVE_NOW, t0, t0 + 8 * MIN)).toBe("aging");
    expect(resultFreshness(LEAVE_NOW, t0, t0 + 16 * MIN)).toBe("stale");
    // Yesterday's leave-now plan is never current.
    expect(resultFreshness(LEAVE_NOW, t0 - 86_400_000, t0)).toBe("stale");
    expect(resultFreshness({ mode: "depart", at: t0 + 30 * MIN }, t0, t0 + 10 * MIN)).toBe("fresh");
    expect(resultFreshness({ mode: "depart", at: t0 + 30 * MIN }, t0, t0 + 40 * MIN)).toBe("past");
  });
});

const T0 = Date.parse("2026-10-13T16:00:00Z");
function opt(p: Partial<RankOption> & { id: string; kind: RankOption["kind"] }): RankOption {
  return {
    requires: [p.kind],
    leaveAt: T0,
    arriveAt: T0 + (p.durationMin ?? 30) * MIN,
    durationMin: 30,
    distanceM: 10_000,
    walkMin: 5,
    waitMin: 0,
    transfers: 0,
    costUsd: 0,
    safety: null,
    access: "not_applicable",
    signature: p.id,
    ...p,
  };
}
const prefs = (p: Partial<TravelPreferences> = {}): TravelPreferences => ({ ...DEFAULT_TRAVEL_PREFERENCES, modes: { ...DEFAULT_TRAVEL_PREFERENCES.modes }, ...p });

describe("hard constraints", () => {
  const drive = opt({ id: "drive", kind: "drive", durationMin: 25, walkMin: 3, costUsd: null });
  const pr = opt({ id: "pr", kind: "park_ride", requires: ["drive", "park_ride", "transit"], durationMin: 40, walkMin: 6, transfers: 0, costUsd: 5 });
  const transit = opt({ id: "transit", kind: "transit", durationMin: 45, walkMin: 14, transfers: 1, costUsd: 5, access: "unverified" });
  const walk = opt({ id: "walk", kind: "walk", durationMin: 95, walkMin: 95, costUsd: 0 });

  it("never offers driving, or park & ride, to someone who turned driving off", () => {
    const p = prefs({ modes: { ...DEFAULT_TRAVEL_PREFERENCES.modes, drive: false } });
    const { eligible, excluded } = applyConstraints([drive, pr, transit, walk], p);
    expect(eligible.map((o) => o.id)).toEqual(["transit", "walk"]);
    expect(excluded.find((e) => e.id === "drive")!.reasons[0]).toMatch(/driving, which you turned off/);
    expect(excluded.find((e) => e.id === "pr")!.reasons[0]).toMatch(/driving/);
    const r = rankOptions(eligible, p, "now");
    expect(r.bestId).toBe("transit");
    expect(r.fastestId).toBe("transit");
  });

  it("applies walking, transfer and step-free limits with reasons", () => {
    const p = prefs({ maxWalkMin: 10, maxTransfers: 0, accessible: true });
    const { eligible, excluded } = applyConstraints([drive, pr, transit, walk], p);
    expect(eligible.map((o) => o.id)).toEqual(["drive", "pr"]);
    const t = excluded.find((e) => e.id === "transit")!.reasons;
    expect(t).toEqual(["14 min of walking (your limit is 10)", "1 transfer (your limit is 0)", "Step-free access is not verified in the published data"]);
    expect(excluded.find((e) => e.id === "walk")!.reasons).toEqual(["95 min of walking (your limit is 10)"]);
  });
});

describe("labels and best match", () => {
  it("does not invent alternatives: a single option is only best and fastest", () => {
    const r = rankOptions([opt({ id: "a", kind: "walk" })], prefs(), "now");
    expect(r.roles.get("a")).toEqual(["fastest", "best"]);
    expect(r.tradeoffs).toEqual([]);
  });

  it("separates the shortest route from the fastest one", () => {
    const fast = opt({ id: "fast", kind: "drive", durationMin: 22, distanceM: 30_000, costUsd: null });
    const short = opt({ id: "short", kind: "drive", durationMin: 31, distanceM: 21_000, costUsd: null });
    const r = rankOptions([short, fast], prefs(), "now");
    expect(r.fastestId).toBe("fast");
    expect(r.roles.get("short")).toContain("shortest");
    expect(r.roles.get("fast")).not.toContain("shortest");
  });

  it("claims lowest cost only when no unknown cost could be cheaper", () => {
    const driveUnknown = opt({ id: "d", kind: "drive", durationMin: 20, costUsd: null });
    const transit = opt({ id: "t", kind: "transit", durationMin: 35, costUsd: 2.5 });
    expect(rankOptions([driveUnknown, transit], prefs(), "now").roles.get("t") ?? []).not.toContain("cheapest");
    const walk = opt({ id: "w", kind: "walk", durationMin: 50, costUsd: 0, walkMin: 50 });
    expect(rankOptions([driveUnknown, transit, walk], prefs(), "now").roles.get("w")).toContain("cheapest");
  });

  it("labels less walking and fewer transfers only when clearly different", () => {
    const a = opt({ id: "a", kind: "transit", durationMin: 30, walkMin: 12, transfers: 1 });
    const b = opt({ id: "b", kind: "transit", durationMin: 34, walkMin: 4, transfers: 0 });
    const c = opt({ id: "c", kind: "transit", durationMin: 33, walkMin: 10, transfers: 1 });
    const r = rankOptions([a, b, c], prefs(), "now");
    expect(r.roles.get("b")).toEqual(expect.arrayContaining(["lessWalking", "fewestTransfers"]));
    expect(r.roles.get("c") ?? []).not.toContain("lessWalking");
  });

  it("compares safety only within one mode", () => {
    const quickWalk = opt({ id: "w1", kind: "walk", durationMin: 20, safety: { score: 50, mode: "walk" } });
    const calmWalk = opt({ id: "w2", kind: "walk", durationMin: 23, safety: { score: 71, mode: "walk" } });
    const drive = opt({ id: "d", kind: "drive", durationMin: 8, safety: { score: 90, mode: "drive" } });
    const r = rankOptions([quickWalk, calmWalk, drive], prefs(), "now");
    expect(r.roles.get("w2")).toContain("saferStreets");
    expect(r.roles.get("d")).not.toContain("saferStreets");
    // A single driving route has nothing to be compared with.
    expect(rankOptions([drive, quickWalk], prefs(), "now").roles.get("d")).toEqual(["fastest", "best"]);
  });

  it("chooses the best match from the person's priority within a stated tolerance", () => {
    const fast = opt({ id: "fast", kind: "drive", durationMin: 30, walkMin: 6, costUsd: 9 });
    const cheap = opt({ id: "cheap", kind: "transit", durationMin: 38, walkMin: 15, costUsd: 2.5, transfers: 1 });
    const slowCheap = opt({ id: "walk", kind: "walk", durationMin: 120, walkMin: 120, costUsd: 0 });
    expect(toleranceFor(30)).toBe(10);
    const r = rankOptions([fast, cheap, slowCheap], prefs({ priority: "cheapest" }), "now");
    // Walking is free but 90 min slower, so it is outside the tolerance.
    expect(r.bestId).toBe("cheap");
    expect(r.explanations.get("cheap")).toMatch(/^Lowest cost among options at most 10 min slower than the fastest/);
    expect(r.tradeoffs[0]).toBe("Your best match takes 8 min longer, saves $6.50 than the fastest option.");
    expect(r.ordered[0]!.id).toBe("cheap");
    const balanced = rankOptions([fast, cheap, slowCheap], prefs(), "now");
    expect(balanced.bestId).toBe("fast");
    const lessWalk = rankOptions([fast, cheap, slowCheap], prefs({ priority: "least_walking" }), "now");
    expect(lessWalk.bestId).toBe("fast");
  });

  it("prefers the chosen kinds of travel among quick options", () => {
    const drive = opt({ id: "d", kind: "drive", durationMin: 20 });
    const transit = opt({ id: "t", kind: "transit", durationMin: 26 });
    const r = rankOptions([drive, transit], prefs({ prefer: ["transit"] }), "now");
    expect(r.bestId).toBe("t");
    expect(r.explanations.get("t")).toMatch(/you prefer transit/);
  });

  it("for arrive-by plans, the balanced match leaves latest", () => {
    const by = Date.parse("2026-10-14T13:00:00Z");
    const early = opt({ id: "early", kind: "transit", leaveAt: by - 50 * MIN, arriveAt: by - 15 * MIN, durationMin: 35 });
    const late = opt({ id: "late", kind: "drive", leaveAt: by - 40 * MIN, arriveAt: by - 2 * MIN, durationMin: 38 });
    const r = rankOptions([early, late], prefs(), "arrive");
    expect(r.fastestId).toBe("early");
    expect(r.bestId).toBe("late");
    expect(r.roles.get("late")).toContain("leaveLatest");
    expect(r.explanations.get("late")).toMatch(/^Leaves latest/);
  });

  it("explains each option only with its own numbers", () => {
    const a = opt({ id: "a", kind: "transit", durationMin: 30, walkMin: 9, transfers: 1, costUsd: 2.5 });
    const b = opt({ id: "b", kind: "transit", durationMin: 36, walkMin: 4, transfers: 0, costUsd: 2.5 });
    const r = rankOptions([a, b], prefs(), "now");
    expect(r.explanations.get("b")).toBe("6 min slower than the fastest, no transfers, 4 min walking, 5 min less walking.");
  });
});

describe("typed requests", () => {
  it("Get me to Georgia Tech without driving", () => {
    const i = parseTripIntent("Get me to Georgia Tech without driving");
    expect(i).toMatchObject({ action: "route", place: "Georgia Tech", modesOff: ["drive", "park_ride"], understood: ["Avoid driving"] });
  });
  it("Find the nearest MARTA station", () => {
    const i = parseTripIntent("Find the nearest MARTA station");
    expect(i).toMatchObject({ action: "nearby_transit", place: "", railOnly: true });
    expect(parseTripIntent("nearest MARTA station to 3500 Peachtree Rd")).toMatchObject({ action: "nearby_transit", place: "3500 Peachtree Rd" });
    expect(parseTripIntent("bus stops near Five Points")).toMatchObject({ action: "nearby_transit", place: "Five Points", railOnly: false });
  });
  it("What is the cheapest way to get downtown?", () => {
    const i = parseTripIntent("What is the cheapest way to get downtown?");
    expect(i).toMatchObject({ action: "route", place: "downtown", priority: "cheapest" });
    expect(expandPlaceAlias(i.place, null)).toBe("Downtown Atlanta, GA");
    expect(expandPlaceAlias(i.place, "athens")).toBe("Downtown Athens, GA");
  });
  it("Help me reach UGA with minimal walking", () => {
    expect(parseTripIntent("Help me reach UGA with minimal walking")).toMatchObject({ action: "route", place: "UGA", priority: "least_walking" });
  });
  it("Find the fastest route with fewer transfers", () => {
    const i = parseTripIntent("Find the fastest route with fewer transfers");
    expect(i).toMatchObject({ action: "route", place: "", priority: "fewest_transfers" });
    expect(i.understood).toEqual(["Fewer transfers", "Fastest"]);
  });
  it("Find parking near this destination", () => {
    expect(parseTripIntent("Find parking near this destination")).toMatchObject({ action: "parking", place: "" });
    expect(parseTripIntent("parking near Sanford Stadium")).toMatchObject({ action: "parking", place: "Sanford Stadium" });
  });
  it("passes plain addresses through untouched", () => {
    expect(parseTripIntent("760 Spring St NW, Atlanta")).toMatchObject({ action: "route", place: "760 Spring St NW, Atlanta", priority: null, understood: [] });
    expect(parseTripIntent("Klaus Advanced Computing Building").place).toBe("Klaus Advanced Computing Building");
    expect(parseTripIntent("No transfers to Lenox Square by MARTA")).toMatchObject({ place: "Lenox Square", maxTransfers: 0, prefer: ["transit"] });
  });
});
