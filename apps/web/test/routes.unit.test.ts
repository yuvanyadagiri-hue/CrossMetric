import { describe, expect, it } from "vitest";
import type { View } from "@/components/commute/model";
import { tabOf } from "@/components/commute/model";
import { PAGE_KINDS, parentView, TAB_ROOTS, viewFromLocation, viewHref } from "@/components/commute/routes";

/** Every screen of the app, with representative payloads. */
const VIEWS: View[] = [
  { kind: "home" },
  { kind: "services" },
  { kind: "activity" },
  { kind: "receipt", id: "ab12cd34" },
  { kind: "safety" },
  { kind: "help" },
  { kind: "search", target: "destination" },
  { kind: "search", target: "origin" },
  { kind: "search", target: "nearby" },
  { kind: "search", target: "save" },
  { kind: "search", target: "start" },
  { kind: "search", target: "arrive" },
  { kind: "arrived" },
  { kind: "plan" },
  { kind: "arrive" },
  { kind: "detail" },
  { kind: "trip" },
  { kind: "nearby", stationId: null },
  { kind: "nearby", stationId: "marta:rail:lindbergh" },
  { kind: "saved", editId: null },
  { kind: "saved", editId: "x1y2z3" },
  { kind: "profile" },
  { kind: "prefs" },
  { kind: "schedule" },
  { kind: "parking", placeId: null },
  { kind: "parking", placeId: "gt-deck-1" },
  { kind: "night" },
  { kind: "parked" },
  { kind: "return" },
  { kind: "stop", stop: { id: "s 1/2", name: "Peachtree Center & 5th", lon: -84.387, lat: 33.759 } },
  { kind: "report" },
  { kind: "community", reportId: null },
  { kind: "community", reportId: "0b6f1c2e-4d5a-4b7c-9e8f-112233445566" },
];

const read = (href: string): View | null => {
  const u = new URL(href, "https://example.test");
  return viewFromLocation(u.pathname, u.searchParams);
};

describe("every screen has its own address", () => {
  it("each screen maps to a path and back to the same screen", () => {
    for (const v of VIEWS) {
      const back = read(viewHref(v));
      // A missing payload reads back as null/undefined; compare through JSON with the optional fields normalised.
      expect(JSON.parse(JSON.stringify(back, (_k, x) => (x === undefined ? null : x)))).toEqual(JSON.parse(JSON.stringify(v, (_k, x) => (x === undefined ? null : x))));
    }
  });

  it("no two screens share an address", () => {
    const seen = new Map<string, string>();
    for (const v of VIEWS) {
      const href = viewHref(v);
      const key = JSON.stringify(v);
      expect(seen.has(href) && seen.get(href) !== key).toBe(false);
      seen.set(href, key);
    }
  });

  it("the main pages have the expected, readable addresses", () => {
    expect(viewHref({ kind: "home" })).toBe("/");
    expect(viewHref({ kind: "services" })).toBe("/services");
    expect(viewHref({ kind: "activity" })).toBe("/activity");
    expect(viewHref({ kind: "profile" })).toBe("/account");
    expect(viewHref({ kind: "plan" })).toBe("/trip");
    expect(viewHref({ kind: "arrive" })).toBe("/arrive");
    expect(viewHref({ kind: "trip" })).toBe("/trip/live");
    expect(viewHref({ kind: "arrived" })).toBe("/trip/arrived");
    expect(viewHref({ kind: "receipt", id: "abc" })).toBe("/activity/abc");
    expect(viewHref({ kind: "search", target: "destination" })).toBe("/search?for=destination");
    expect(viewHref({ kind: "report" })).toBe("/report");
    expect(viewHref({ kind: "community", reportId: null })).toBe("/community");
  });

  it("a community link only opens a report with a well-formed id", () => {
    expect(read("/community?report=../../etc")).toEqual({ kind: "community", reportId: null });
    expect(read("/community?report=0b6f1c2e-4d5a-4b7c-9e8f-112233445566")).toEqual({ kind: "community", reportId: "0b6f1c2e-4d5a-4b7c-9e8f-112233445566" });
  });

  it("a trailing slash and unknown search targets are tolerated; unknown pages are not screens", () => {
    expect(read("/services/")?.kind).toBe("services");
    expect(read("/search?for=nonsense")).toEqual({ kind: "search", target: "destination" });
    expect(read("/analyze")).toBeNull();
    expect(read("/explore")).toBeNull();
    expect(read("/activity/a/b")).toBeNull();
  });

  it("a stop link without its stop is not a stop screen", () => {
    expect(read("/stop")).toEqual({ kind: "services" });
    expect(read("/stop?id=s1&name=Stop&lon=abc&lat=33.7")).toEqual({ kind: "services" });
    expect(read("/stop?id=s1&name=Stop&lon=-84.3&lat=33.7")).toEqual({ kind: "stop", stop: { id: "s1", name: "Stop", lon: -84.3, lat: 33.7 } });
  });

  it("back from a page opened directly goes to its parent, and every parent is a real screen", () => {
    for (const v of VIEWS) {
      const parent = parentView(v);
      expect(read(viewHref(parent))).not.toBeNull();
    }
    expect(parentView({ kind: "receipt", id: "x" })).toEqual({ kind: "activity" });
    expect(parentView({ kind: "saved", editId: null })).toEqual({ kind: "profile" });
    expect(parentView({ kind: "nearby", stationId: null })).toEqual({ kind: "services" });
  });
});

describe("tabs and pages", () => {
  it("the four tab roots (Explore, Routes, Report, Community) are map screens with the tab bar", () => {
    expect([...TAB_ROOTS].sort()).toEqual(["community", "home", "plan", "report"]);
    for (const k of TAB_ROOTS) expect(PAGE_KINDS.has(k)).toBe(false);
  });

  it("the trip flow, Explore, Report and Community are a map with a sheet, not a page", () => {
    for (const k of ["home", "plan", "detail", "trip", "nearby", "parking", "night", "parked", "return", "stop", "report", "community"] as const) expect(PAGE_KINDS.has(k)).toBe(false);
    for (const k of ["services", "activity", "receipt", "profile", "saved", "prefs", "schedule", "safety", "help", "search", "arrived"] as const) expect(PAGE_KINDS.has(k)).toBe(true);
  });

  it("each screen belongs to one destination", () => {
    expect(tabOf({ kind: "home" })).toBe("explore");
    expect(tabOf({ kind: "parking", placeId: null })).toBe("explore");
    expect(tabOf({ kind: "plan" })).toBe("routes");
    expect(tabOf({ kind: "receipt", id: "x" })).toBe("routes");
    expect(tabOf({ kind: "report" })).toBe("report");
    expect(tabOf({ kind: "community", reportId: null })).toBe("community");
    expect(tabOf({ kind: "help" })).toBe("account");
    expect(tabOf({ kind: "saved", editId: null })).toBe("account");
  });
});
