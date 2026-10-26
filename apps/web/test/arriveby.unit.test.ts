import { describe, expect, it } from "vitest";
import { accessText, arriveParkingStatus, dayText, provenanceLine, rangeText, STATUS_WORD, usablePlace, VERDICT_LABEL } from "@/lib/arriveby-format";

describe("ArriveBy labels say exactly what the data is", () => {
  it("shows the source, its trust level and the dates it was checked", () => {
    expect(provenanceLine({ status: "official", label: "GT Parking & Transportation — Visitor parking", retrieved: "2026-10-12", reviewBy: "2026-11-12" })).toBe("Official · GT Parking & Transportation — Visitor parking · checked Oct 12, 2026 · re-check by Nov 12, 2026");
    expect(provenanceLine({ status: "estimate", label: "Routed walking time at your walking speed" })).toBe("Estimate · Routed walking time at your walking speed");
    expect(provenanceLine({ status: "community", label: "Entrance mapped in OpenStreetMap", retrieved: "2026-10-13" })).toBe("Community data · Entrance mapped in OpenStreetMap · data from Oct 13, 2026");
    expect(provenanceLine({ status: "user", label: "Your permit, as you entered it." })).toMatch(/^From you · /);
    expect(provenanceLine({ status: "unknown", label: "No occupancy data is published for this place" })).toMatch(/^Not available · /);
  });

  it("reads calendar dates without shifting them by time zone", () => {
    expect(dayText("2026-11-01")).toBe("Nov 1, 2026");
    expect(dayText("not a date")).toBe("not a date");
  });

  it("has a word for every trust level, including example data", () => {
    expect(Object.keys(STATUS_WORD).sort()).toEqual(["community", "estimate", "illustrative", "live", "official", "unknown", "user"]);
    expect(STATUS_WORD.illustrative).toBe("Example data");
  });

  it("writes ranges without false precision", () => {
    expect(rangeText({ low: 16, high: 25 })).toBe("16–25 min");
    expect(rangeText({ low: 7, high: 7 })).toBe("7 min");
    expect(rangeText({ low: 6.6, high: 7.2 })).toBe("7 min");
    expect(rangeText({ low: 55, high: 70 })).toBe("55 min–1 hr 10 min");
    expect(rangeText({ low: 43, high: 60 })).toBe("43 min–1 hr");
    expect(rangeText({ low: 65, high: 80 })).toBe("1 hr 5 min–1 hr 20 min");
    expect(rangeText({ low: 60, high: 60 })).toBe("1 hr");
  });

  it("maps verdicts to map colours without turning unknown into allowed", () => {
    expect(arriveParkingStatus({ verdict: "recommended", access: "your_permit" })).toBe("allowed");
    expect(arriveParkingStatus({ verdict: "eligible", access: "pay" })).toBe("requires_action");
    expect(arriveParkingStatus({ verdict: "uncertain", access: "unknown" })).toBe("unknown");
    expect(arriveParkingStatus({ verdict: "unavailable", access: "pay" })).toBe("unknown");
    expect(arriveParkingStatus({ verdict: "full", access: "pay" })).toBe("prohibited");
    expect(usablePlace({ verdict: "uncertain" })).toBe(false);
    expect(usablePlace({ verdict: "backup" })).toBe(true);
    expect(VERDICT_LABEL.full).toBe("Reported full");
    expect(accessText("your_permit", "W23")).toBe("Your permit (W23)");
    expect(accessText("unknown", "W23")).toBe("Rules unclear");
  });
});
