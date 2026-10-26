import { describe, expect, it } from "vitest";
import { decodePlace, encodePlace, parseMode, tripHref } from "@/lib/place-url";
import { reportStatus, validateReport, verificationLevel, type CommunityReport } from "@/lib/reports";
import { lightAt, solarElevationDeg } from "@/lib/sun";
import { formatDistance, formatDuration, isGeorgiaPoint, routedMode } from "@/lib/trip-types";

describe("trip URLs", () => {
  const tech = { label: "Georgia Institute of Technology, Atlanta", lon: -84.394832, lat: 33.77242, kind: "college" as const, id: "139755" };

  it("round-trips a place, including commas in the label", () => {
    const decoded = decodePlace(encodePlace(tech));
    expect(decoded).toEqual({ label: "Georgia Institute of Technology, Atlanta", lon: -84.39483, lat: 33.77242, kind: "college", id: "139755" });
  });

  it("never writes the user's current location into a link", () => {
    expect(encodePlace({ label: "My location", lon: -84.39, lat: 33.77, kind: "current" })).toBeNull();
    const href = tripHref("/routes", { label: "My location", lon: -84.39, lat: 33.77, kind: "current" }, tech, "walk");
    expect(href).not.toContain("from=");
    expect(href).toContain("to=");
  });

  it("rejects places outside Georgia, bad ids and unknown modes", () => {
    expect(decodePlace("-118.24,34.05,place,,Los Angeles")).toBeNull();
    expect(decodePlace("-84.39,33.77,college,../../x,Tech")?.id).toBeUndefined();
    expect(decodePlace("garbage")).toBeNull();
    expect(parseMode("teleport")).toBe("walk");
    expect(parseMode("rideshare")).toBe("rideshare");
  });

  it("routes rideshare as driving and leaves transit unscored", () => {
    expect(routedMode("rideshare")).toBe("drive");
    expect(routedMode("transit")).toBeNull();
  });

  it("formats durations and distances for people", () => {
    expect(formatDuration(20)).toBe("1 min");
    expect(formatDuration(31 * 60)).toBe("31 min");
    expect(formatDuration(95 * 60)).toBe("1 hr 35 min");
    expect(formatDistance(3380)).toBe("2.1 mi");
    expect(formatDistance(55)).toBe("180 ft");
    expect(isGeorgiaPoint(-84.39, 33.77)).toBe(true);
    expect(isGeorgiaPoint(-84.39, 36.5)).toBe(false);
  });
});

describe("community report validation", () => {
  const base = { category: "difficult_crossing", lon: -84.39, lat: 33.77 };

  it("accepts a clean report and trims the description", () => {
    const r = validateReport({ ...base, description: "  No crosswalk   at the bus stop. ", locationLabel: "10th St" });
    expect(r).toEqual({ ok: true, value: { category: "difficult_crossing", description: "No crosswalk at the bus stop.", lon: -84.39, lat: 33.77, locationLabel: "10th St" } });
  });

  it("rejects unknown categories, places outside Georgia, links and contact details", () => {
    expect(validateReport({ ...base, category: "potholes!" }).ok).toBe(false);
    expect(validateReport({ ...base, lon: -100 }).ok).toBe(false);
    expect(validateReport({ ...base, description: "see https://spam.example" }).ok).toBe(false);
    expect(validateReport({ ...base, description: "call me 404-555-1212" }).ok).toBe(false);
    expect(validateReport({ ...base, description: "x".repeat(281) }).ok).toBe(false);
    expect(validateReport(null).ok).toBe(false);
  });

  it("derives status and verification from votes", () => {
    const r: CommunityReport = { id: "x", category: "blocked_path", description: null, lon: -84.39, lat: 33.77, locationLabel: null, createdAt: new Date().toISOString(), confirmations: 0, resolvedVotes: 0 };
    expect(verificationLevel(r)).toBe("unverified");
    expect(verificationLevel({ ...r, confirmations: 2 })).toBe("community-confirmed");
    expect(reportStatus({ ...r, resolvedVotes: 2 })).toBe("reported-fixed");
    expect(reportStatus({ ...r, resolvedVotes: 2, confirmations: 5 })).toBe("open");
  });
});

describe("daylight", () => {
  it("knows noon from midnight in Atlanta", () => {
    // 17:00 UTC is about 1 pm in Atlanta in October; 05:00 UTC is about 1 am.
    expect(lightAt(new Date("2026-10-05T17:00:00Z"), 33.75, -84.39)).toBe("daylight");
    expect(lightAt(new Date("2026-10-05T05:00:00Z"), 33.75, -84.39)).toBe("dark");
    const noon = solarElevationDeg(new Date("2026-06-21T17:30:00Z"), 33.75, -84.39);
    expect(noon).toBeGreaterThan(75);
    expect(noon).toBeLessThan(81);
  });
});
