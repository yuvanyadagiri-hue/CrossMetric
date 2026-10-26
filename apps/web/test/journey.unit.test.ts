import { describe, expect, it } from "vitest";
import { DEFAULT_TRAVEL_PREFERENCES, LEAVE_NOW, parseTripIntent, zonedToUtc } from "@crossmetric/engine/commute";
import { actionable, effectivePrefs, frequentRoutes, greeting, journeyPhase, normalizeTravel, pushRecent, recentFrom, restoreRecent, type PhaseInput } from "@/lib/journey-client";
import type { JourneyPlace } from "@/lib/journey-types";

const at = (date: string, time: string) => {
  const [h, m] = time.split(":").map(Number);
  return zonedToUtc(date, h! * 60 + m!);
};
const MIN = 60_000;
const NOW = at("2026-10-13", "21:30");
const HOME: JourneyPlace = { label: "Home", lon: -84.36, lat: 33.8, source: "saved" };
const GT: JourneyPlace = { label: "Georgia Tech", lon: -84.3963, lat: 33.7756, source: "college" };
const HERE: JourneyPlace = { label: "Current location", lon: -84.38, lat: 33.79, source: "current" };

const phase = (p: Partial<PhaseInput>) =>
  journeyPhase({ hasOrigin: true, hasDestination: true, inputKey: "k1", resultKey: "k1", generatedAt: NOW, loading: false, error: false, online: true, timing: LEAVE_NOW, now: NOW, ...p });

describe("results describe exactly the inputs on screen", () => {
  it("asks for what is missing before planning", () => {
    expect(phase({ hasDestination: false })).toBe("needs_destination");
    expect(phase({ hasOrigin: false })).toBe("needs_origin");
  });

  it("marks results stale the moment origin, destination, mode or time changes", () => {
    // The inputs changed (new key); the old results are not current while the new search waits or runs.
    expect(phase({ inputKey: "k2" })).toBe("updating");
    expect(phase({ inputKey: "k2", loading: true })).toBe("updating");
    expect(actionable(phase({ inputKey: "k2" }))).toBe(false);
    expect(phase({ inputKey: "k2", error: true })).toBe("error");
    expect(phase({ inputKey: "k2", online: false })).toBe("offline");
  });

  it("first search shows loading, then ready", () => {
    expect(phase({ resultKey: null, loading: true })).toBe("loading");
    expect(phase({})).toBe("ready");
    expect(actionable("ready")).toBe(true);
  });

  it("a leave-now result ages and then goes stale; yesterday's is never current", () => {
    expect(phase({ now: NOW + 8 * MIN })).toBe("aging");
    expect(phase({ now: NOW + 20 * MIN })).toBe("stale");
    expect(phase({ generatedAt: NOW - 24 * 3600_000 })).toBe("stale");
    expect(actionable("stale")).toBe(false);
  });

  it("a chosen departure that has passed is stale, not silently moved", () => {
    const timing = { mode: "depart" as const, at: NOW + 30 * MIN };
    expect(phase({ timing })).toBe("ready");
    expect(phase({ timing, now: NOW + 45 * MIN })).toBe("stale");
  });
});

describe("recent searches", () => {
  it("stores a current-location start without coordinates", () => {
    const r = recentFrom(HERE, GT, LEAVE_NOW, NOW);
    expect(r.from).toEqual({ current: true });
    expect(JSON.stringify(r)).not.toContain("-84.38");
  });

  it("restoring brings back the places, not the old time", () => {
    const tomorrow = { mode: "arrive" as const, by: at("2026-10-14", "09:00") };
    const r = restoreRecent(recentFrom(HOME, GT, tomorrow, NOW - 3600_000), NOW);
    expect(r.timing).toEqual(LEAVE_NOW);
    expect(r.originalTiming).toEqual(tomorrow);
    expect(r.origin).toEqual(HOME);
    // Once the original time has passed it is not offered.
    expect(restoreRecent(recentFrom(HOME, GT, tomorrow, NOW), at("2026-10-14", "10:00")).originalTiming).toBeNull();
    // A current-location start needs the location again.
    expect(restoreRecent(recentFrom(HERE, GT, LEAVE_NOW, NOW), NOW)).toMatchObject({ origin: null, needsLocation: true });
  });

  it("deduplicates, caps the list and finds frequent routes", () => {
    let list = pushRecent([], recentFrom(HOME, GT, LEAVE_NOW, NOW));
    list = pushRecent(list, recentFrom(HOME, GT, LEAVE_NOW, NOW + MIN));
    expect(list).toHaveLength(1);
    const many = Array.from({ length: 20 }, (_, i) => recentFrom({ ...HOME, lon: -84 - i / 100 }, GT, LEAVE_NOW, NOW));
    expect(many.reduce((l, e) => pushRecent(l, e), [] as typeof list)).toHaveLength(12);
    const freq = frequentRoutes([recentFrom(HOME, GT, LEAVE_NOW, NOW), recentFrom(HOME, GT, LEAVE_NOW, NOW - MIN), recentFrom(HERE, GT, LEAVE_NOW, NOW)]);
    expect(freq).toHaveLength(1);
    expect(freq[0]!.count).toBe(2);
  });
});

describe("preferences used by a search", () => {
  it("applies a typed request on top of saved preferences, for this search only", () => {
    const i = parseTripIntent("Get me to Georgia Tech without driving");
    const p = effectivePrefs(DEFAULT_TRAVEL_PREFERENCES, true, { ...i, understood: i.understood });
    expect(p.modes.drive).toBe(false);
    expect(p.modes.park_ride).toBe(false);
    expect(p.modes.transit).toBe(true);
    expect(DEFAULT_TRAVEL_PREFERENCES.modes.drive).toBe(true);
  });

  it("removes driving for someone without a car", () => {
    const p = effectivePrefs(DEFAULT_TRAVEL_PREFERENCES, false, null);
    expect(p.modes.drive).toBe(false);
    expect(p.modes.park_ride).toBe(false);
  });

  it("fills preferences saved by an older version", () => {
    const p = normalizeTravel({ modes: { walk: false } as never, priority: "cheapest" });
    expect(p.modes).toEqual({ ...DEFAULT_TRAVEL_PREFERENCES.modes, walk: false });
    expect(p.prefer).toEqual([]);
    expect(p.priority).toBe("cheapest");
  });

  it("greets by Georgia time", () => {
    expect(greeting(at("2026-10-13", "08:00"))).toBe("Good morning");
    expect(greeting(at("2026-10-13", "13:00"))).toBe("Good afternoon");
    expect(greeting(at("2026-10-13", "22:00"))).toBe("Good evening");
  });
});
