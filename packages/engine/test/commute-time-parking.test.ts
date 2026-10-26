import { describe, expect, it } from "vitest";
import { addDays, clockLabel, localDate, localMinutes, serviceDayStart, tzOffsetMinutes, weekdayOf, zonedToUtc } from "../src/commute/time";
import { evaluateNow, evaluateStay, tieredPrice, type ParkingPlaceRules, type ParkingRule, type VehicleProfile } from "../src/commute/parking";

const at = (date: string, time: string) => {
  const [h, m] = time.split(":").map(Number);
  return zonedToUtc(date, h! * 60 + m!);
};
const ALL = [0, 1, 2, 3, 4, 5, 6] as const;
const WEEKDAYS = [1, 2, 3, 4, 5] as const;

describe("campus time", () => {
  it("converts wall-clock times across both DST transitions", () => {
    // 2026-03-08 spring forward, 2026-11-01 fall back (America/New_York).
    expect(new Date(at("2026-03-07", "09:00")).toISOString()).toBe("2026-03-07T14:00:00.000Z");
    expect(new Date(at("2026-03-09", "09:00")).toISOString()).toBe("2026-03-09T13:00:00.000Z");
    expect(new Date(at("2026-10-30", "09:00")).toISOString()).toBe("2026-10-30T13:00:00.000Z");
    expect(new Date(at("2026-11-02", "09:00")).toISOString()).toBe("2026-11-02T14:00:00.000Z");
    expect(tzOffsetMinutes(at("2026-07-01", "12:00"))).toBe(-240);
    expect(tzOffsetMinutes(at("2026-12-01", "12:00"))).toBe(-300);
  });

  it("round-trips local date and minutes", () => {
    const t = at("2026-10-12", "17:45");
    expect(localDate(t)).toBe("2026-10-12");
    expect(localMinutes(t)).toBe(17 * 60 + 45);
    expect(clockLabel(t)).toBe("5:45 PM");
    expect(clockLabel(at("2026-10-12", "00:05"))).toBe("12:05 AM");
  });

  it("handles date arithmetic and weekdays", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(weekdayOf("2026-10-12")).toBe(1); // Monday
    expect(weekdayOf("2026-10-17")).toBe(6);
  });

  it("anchors GTFS service days at noon minus 12 hours, even on DST days", () => {
    // On the fall-back day the reference is not local midnight; GTFS times count from noon minus 12 h.
    const ref = serviceDayStart("2026-11-01");
    expect(ref).toBe(at("2026-11-01", "12:00") - 12 * 3_600_000);
    expect(serviceDayStart("2026-10-12")).toBe(at("2026-10-12", "00:00"));
  });
});

const deckRate = { kind: "tiered" as const, tiers: [{ upToMin: 60, price: 3 }, { upToMin: 120, price: 6 }, { upToMin: 180, price: 9 }, { upToMin: 240, price: 12 }, { upToMin: 1440, price: 15 }], repeatsAfterMin: 1440 };

function place(rules: ParkingRule[], extra: Partial<ParkingPlaceRules> = {}): ParkingPlaceRules {
  return { placeId: "p", code: "N04", rules, overrides: [], reviewBy: "2026-11-12", ...extra };
}

const NO_PERMIT: VehicleProfile = { permits: [], registered: false };
const REGISTERED: VehicleProfile = { permits: [], registered: true };
const UNSURE: VehicleProfile = { permits: [], registered: null };

// UGA-style surface lot: permit only 7-5 weekdays, registered vehicles 5-midnight, free weekends.
const ugaLot = place([
  { id: "permit-day", windows: [{ days: [...WEEKDAYS], start: 7 * 60, end: 17 * 60 }], audience: "permit", access: "free", sourceId: "enf", label: "Permit only" },
  { id: "registered-evening", windows: [{ days: [...WEEKDAYS], start: 17 * 60, end: 1440 }], audience: "registered", access: "free", sourceId: "enf" },
  { id: "weekend", windows: [{ days: [0, 6], start: 0, end: 1440 }], audience: "any", access: "free", sourceId: "enf" },
]);

describe("parking rule evaluator", () => {
  it("never assumes after-5 is free: permit-only daytime rejects a driver without a permit", () => {
    const r = evaluateStay(ugaLot, NO_PERMIT, at("2026-10-13", "16:00"), at("2026-10-13", "19:00"));
    expect(r.status).toBe("prohibited");
    expect(r.reason).toBe("Permit required");
    expect(r.price).toBeNull();
  });

  it("allows the evening stay for a registered vehicle and reports when eligibility starts", () => {
    const r = evaluateStay(ugaLot, REGISTERED, at("2026-10-13", "17:30"), at("2026-10-13", "21:00"));
    expect(r.status).toBe("allowed");
    expect(r.price).toBe(0);
    expect(r.usableUntil).toBe(at("2026-10-13", "21:00"));
  });

  it("distinguishes registration from a permit, and an unstated registration stays unknown", () => {
    expect(evaluateStay(ugaLot, NO_PERMIT, at("2026-10-13", "18:00"), at("2026-10-13", "20:00")).reason).toBe("Registered vehicles only");
    const unsure = evaluateStay(ugaLot, UNSURE, at("2026-10-13", "18:00"), at("2026-10-13", "20:00"));
    expect(unsure.status).toBe("unknown");
    expect(unsure.reason).toBe("Vehicle registration not set");
  });

  it("rejects a stay when the rule changes during class (full-stay check)", () => {
    // Evening is fine for a registered car, but the stay runs into Wednesday's 7 AM permit window.
    const r = evaluateStay(ugaLot, REGISTERED, at("2026-10-13", "22:00"), at("2026-10-14", "08:00"));
    expect(r.status).toBe("prohibited");
    // Midnight to 7 AM is unpublished, so it is unknown before it is prohibited.
    expect(r.segments.map((s) => s.status)).toEqual(["allowed", "unknown", "prohibited"]);
    expect(r.nextChange?.at).toBe(at("2026-10-14", "00:00"));
    expect(r.usableUntil).toBe(at("2026-10-14", "00:00"));
  });

  it("treats a game-day override as unknown even when the weekend rule says free", () => {
    const game = place(ugaLot.rules, {
      overrides: [{ id: "fb", start: at("2026-10-16", "17:00"), end: at("2026-10-18", "00:00"), effect: "unknown", label: "Home football", sourceId: "news" }],
    });
    const sat = evaluateStay(game, NO_PERMIT, at("2026-10-17", "10:00"), at("2026-10-17", "14:00"));
    expect(sat.status).toBe("unknown");
    expect(sat.reason).toBe("Home football · rules unconfirmed");
    const nextSat = evaluateStay(game, NO_PERMIT, at("2026-10-24", "10:00"), at("2026-10-24", "14:00"));
    expect(nextSat.status).toBe("allowed");
  });

  it("excludes a closed place for the event dates", () => {
    const closed = place(ugaLot.rules, { overrides: [{ id: "c", start: at("2026-10-24", "06:00"), end: at("2026-10-24", "23:00"), effect: "closed", label: "Event", sourceId: "ops" }] });
    expect(evaluateStay(closed, NO_PERMIT, at("2026-10-24", "09:00"), at("2026-10-24", "10:00")).status).toBe("prohibited");
  });

  it("prices a pay-at-exit deck on the whole stay, repeating after 24 hours", () => {
    const deck = place([{ id: "deck", windows: [{ days: [...ALL], start: 0, end: 1440 }], audience: "any", access: "pay", rate: deckRate, sourceId: "v" }], { code: "W02" });
    expect(evaluateStay(deck, NO_PERMIT, at("2026-10-13", "08:00"), at("2026-10-13", "10:30")).price).toBe(9);
    // Crossing midnight does not restart the session.
    expect(evaluateStay(deck, NO_PERMIT, at("2026-10-13", "23:00"), at("2026-10-14", "00:30")).price).toBe(6);
    expect(tieredPrice(deckRate, 26 * 60)).toBe(15 + 6);
    const r = evaluateStay(deck, NO_PERMIT, at("2026-10-13", "08:00"), at("2026-10-13", "12:00"));
    expect(r.status).toBe("requires_action");
  });

  it("caps tiered visitor rates at the daily maximum", () => {
    const uga = { kind: "tiered" as const, tiers: [{ upToMin: 30, price: 1.5 }, { upToMin: 60, price: 4.5 }, { upToMin: 120, price: 7.5 }], thenPerHour: 1.5, dailyMax: 15, repeatsAfterMin: 1440 };
    expect(tieredPrice(uga, 25)).toBe(1.5);
    expect(tieredPrice(uga, 150)).toBe(9);
    expect(tieredPrice(uga, 600)).toBe(15);
  });

  it("enforces maximum stay limits", () => {
    const meter = place([{ id: "m", windows: [{ days: [...WEEKDAYS], start: 6 * 60, end: 20 * 60 }], audience: "any", access: "pay", rate: { kind: "hourly", perHour: 2 }, maxStayMin: 240, sourceId: "v" }]);
    const ok = evaluateStay(meter, NO_PERMIT, at("2026-10-13", "09:00"), at("2026-10-13", "12:00"));
    expect(ok.status).toBe("requires_action");
    expect(ok.price).toBe(6);
    const long = evaluateStay(meter, NO_PERMIT, at("2026-10-13", "09:00"), at("2026-10-13", "15:00"));
    expect(long.status).toBe("prohibited");
    expect(long.reason).toBe("4h limit");
    expect(long.usableUntil).toBe(at("2026-10-13", "13:00"));
  });

  it("returns unknown when the place has no rule for part of the stay", () => {
    const dayOnly = place([{ id: "d", windows: [{ days: [...WEEKDAYS], start: 7 * 60, end: 17 * 60 }], audience: "any", access: "free", sourceId: "v" }]);
    const r = evaluateStay(dayOnly, NO_PERMIT, at("2026-10-13", "16:00"), at("2026-10-13", "18:00"));
    expect(r.status).toBe("unknown");
    expect(r.reason).toBe("No published rule for this time");
  });

  it("treats an expired rule record as unknown, never as free", () => {
    const stale = place(ugaLot.rules, { reviewBy: "2026-09-01" });
    const r = evaluateStay(stale, REGISTERED, at("2026-10-13", "18:00"), at("2026-10-13", "20:00"), at("2026-10-13", "17:00"));
    expect(r.status).toBe("unknown");
    expect(r.reason).toBe("Rules need re-checking");
  });

  it("honours a permit for this place's code only", () => {
    const withPermit: VehicleProfile = { permits: ["n04"], registered: false };
    expect(evaluateStay(ugaLot, withPermit, at("2026-10-13", "08:00"), at("2026-10-13", "12:00")).status).toBe("allowed");
    expect(evaluateStay({ ...ugaLot, code: "S09" }, withPermit, at("2026-10-13", "08:00"), at("2026-10-13", "12:00")).status).toBe("prohibited");
  });

  it("an unclear official rule makes the stay unknown", () => {
    const deckAfterHours = place([
      { id: "reg", windows: [{ days: [...WEEKDAYS], start: 17 * 60, end: 1440 }], audience: "registered", access: "free", sourceId: "enf" },
      { id: "visitor-unclear", windows: [{ days: [...WEEKDAYS], start: 17 * 60, end: 1440 }], audience: "any", access: "unknown", sourceId: "vis", note: "Visitor rate after 5 PM unclear" },
    ]);
    const r = evaluateStay(deckAfterHours, NO_PERMIT, at("2026-10-13", "18:00"), at("2026-10-13", "19:00"));
    expect(r.status).toBe("unknown");
    expect(r.reason).toBe("Visitor rate after 5 PM unclear");
    expect(evaluateStay(deckAfterHours, REGISTERED, at("2026-10-13", "18:00"), at("2026-10-13", "19:00")).status).toBe("allowed");
  });

  it("'rules now' reports the current state and the next change without a full-stay claim", () => {
    const r = evaluateNow(ugaLot, REGISTERED, at("2026-10-13", "16:30"));
    expect(r.status).toBe("prohibited");
    expect(r.price).toBeNull();
    expect(r.nextChange).toEqual({ at: at("2026-10-13", "17:00"), status: "allowed", reason: "No charge" });
  });
});
