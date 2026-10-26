import { describe, expect, it } from "vitest";
import type { SchoolSummary } from "@/lib/published";
import { normalize, scoreSchool, searchSchools, tokens } from "@/lib/search";
import { applyPatch, DEFAULTS, parseWorkspace } from "@/lib/workspace";
import { circleRing } from "@/lib/geojson";

const school = (id: string, name: string, city: string, district: string): SchoolSummary => ({
  id, name, city, district, level: "High", lon: -84.2, lat: 34, candidates800: 10, crashes1200: 5,
});

// Hand-written search fixtures (names only; no real records needed for ranking rules).
const SCHOOLS = [
  school("1", "Northview High School", "Duluth", "Fulton County"),
  school("2", "North View Elementary School", "Atlanta", "Atlanta Public Schools"),
  school("3", "Northgate High School", "Newnan", "Coweta County"),
  school("4", "Duluth High School", "Duluth", "Gwinnett County"),
  school("5", "St. Simons Elementary School", "St Simons Island", "Glynn County"),
];

describe("school search", () => {
  it("normalizes punctuation, case and accents", () => {
    expect(normalize("  St. Simons  Élementary ")).toBe("st simons elementary");
    expect(tokens("Northview HS")).toEqual(["northview", "high"]);
  });

  it("ranks an exact or prefix name match first", () => {
    const hits = searchSchools(SCHOOLS, "northview");
    expect(hits[0]!.school.name).toBe("Northview High School");
  });

  it("expands common abbreviations", () => {
    expect(searchSchools(SCHOOLS, "north view elem")[0]!.school.id).toBe("2");
    expect(searchSchools(SCHOOLS, "st simons elem")[0]!.school.id).toBe("5");
  });

  it("matches by city or district and says so", () => {
    const hits = searchSchools(SCHOOLS, "duluth");
    expect(hits.map((h) => h.school.id).sort()).toEqual(["1", "4"]);
    expect(hits.find((h) => h.school.id === "1")!.matched).toBe("city");
    expect(searchSchools(SCHOOLS, "coweta")[0]!.matched).toBe("district");
  });

  it("returns nothing for empty or unmatched queries", () => {
    expect(searchSchools(SCHOOLS, "   ")).toEqual([]);
    expect(scoreSchool("zzzz", SCHOOLS[0]!)).toBeNull();
  });
});

describe("workspace URL state", () => {
  it("uses defaults for a fresh analysis", () => {
    const ws = parseWorkspace("130228002560", new URLSearchParams(""));
    expect(ws.analysisRadiusMeters).toBe(DEFAULTS.radius);
    expect(ws.analysisPeriodYears).toBe(3);
    expect(ws.activeFilters.crashFilter).toBe("all");
    expect(ws.activeScoringScenario).toBe("standard");
    expect(ws.selectedCandidateId).toBeNull();
    expect(ws.view).toBe("list");
  });

  it("recreates a shared analysis from its URL", () => {
    const ws = parseWorkspace(
      "130228002560",
      new URLSearchParams("radius=1200&period=1&filter=pedestrian&scenario=pedestrian&candidate=I2bb4f7aeda&compare=I2bb4f7aeda,Sc233435222&capacity=5&view=planner"),
    );
    expect(ws).toMatchObject({
      analysisRadiusMeters: 1200,
      analysisPeriodYears: 1,
      activeFilters: { crashFilter: "pedestrian" },
      activeScoringScenario: "pedestrian",
      selectedCandidateId: "I2bb4f7aeda",
      comparedCandidateIds: ["I2bb4f7aeda", "Sc233435222"],
      plannerCapacity: 5,
      view: "planner",
    });
  });

  it("rejects invalid or hostile values instead of trusting the URL", () => {
    const ws = parseWorkspace(
      "x",
      new URLSearchParams("radius=999&period=5&filter=<script>&scenario=foo&candidate=../../etc&compare=a,b,I2bb4f7aeda,I2bb4f7aeda&capacity=-3"),
    );
    expect(ws.analysisRadiusMeters).toBe(800);
    expect(ws.analysisPeriodYears).toBe(3); // a 5-year period is not supported by the data
    expect(ws.activeFilters.crashFilter).toBe("all");
    expect(ws.activeScoringScenario).toBe("standard");
    expect(ws.selectedCandidateId).toBeNull();
    expect(ws.comparedCandidateIds).toEqual(["I2bb4f7aeda"]);
    expect(ws.plannerCapacity).toBeNull();
  });

  it("writes only non-default values so links stay short", () => {
    const p = applyPatch(new URLSearchParams(""), { radius: 800, scenario: "injury", candidate: "I2bb4f7aeda" });
    expect(p.toString()).toBe("scenario=injury&candidate=I2bb4f7aeda");
    expect(applyPatch(p, { scenario: "standard", candidate: null }).toString()).toBe("");
  });
});

describe("map geometry", () => {
  it("draws a closed geodesic circle of the requested radius", () => {
    const ring = circleRing(-84.1777, 34.0393, 800, 64);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    // north-most point should be ~800 m north: 800 / 111,195 m per degree
    const maxLat = Math.max(...ring.map((p) => p[1]));
    expect((maxLat - 34.0393) * 111_195).toBeCloseTo(800, -1);
  });
});
