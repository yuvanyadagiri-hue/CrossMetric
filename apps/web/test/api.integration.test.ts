/**
 * Integration tests: real API route handlers + the file repository + the real
 * published pipeline output (data/published). Skipped if the pipeline hasn't run.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { planReviews, runAnalysis, type SchoolPackage } from "@crossmetric/engine";
import { GET as getMeta } from "@/app/api/meta/route";
import { GET as getSchool } from "@/app/api/schools/[id]/route";
import { GET as getIndex } from "@/app/api/schools/route";
import { GET as search } from "@/app/api/schools/search/route";

const hasData = existsSync(path.resolve(process.cwd(), "..", "..", "data", "published", "index.json"));
const NORTHVIEW = "130228002560";

describe.skipIf(!hasData)("API integration (real published data)", () => {
  it("searches schools by name", async () => {
    const res = await search(new NextRequest("http://localhost/api/schools/search?q=northview%20high"));
    const body = (await res.json()) as { results: { id: string; name: string }[] };
    expect(res.status).toBe(200);
    expect(body.results[0]).toMatchObject({ id: NORTHVIEW, name: "Northview High School" });
  });

  it("searches schools by city or district", async () => {
    const res = await search(new NextRequest("http://localhost/api/schools/search?q=savannah&limit=25"));
    const body = (await res.json()) as { results: { name: string; city: string; district: string }[] };
    expect(body.results.length).toBeGreaterThan(5);
    // Savannah-Chatham County schools in Pooler or Garden City match through their district
    expect(body.results.every((r) => `${r.name} ${r.city} ${r.district}`.toLowerCase().includes("savannah"))).toBe(true);
  });

  it("serves the statewide school index", async () => {
    const body = (await (await getIndex()).json()) as { schools: unknown[]; window: { start: string } };
    expect(body.schools.length).toBeGreaterThan(2000);
    expect(body.window.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("validates school ids and returns 404 for unknown schools", async () => {
    const bad = await getSchool(new Request("http://localhost"), { params: Promise.resolve({ id: "../../secrets" }) });
    expect(bad.status).toBe(400);
    const missing = await getSchool(new Request("http://localhost"), { params: Promise.resolve({ id: "999999999999" }) });
    expect(missing.status).toBe(404);
  });

  it("returns a school package the engine can analyze end to end", async () => {
    const res = await getSchool(new Request("http://localhost"), { params: Promise.resolve({ id: NORTHVIEW }) });
    expect(res.status).toBe(200);
    const pkg = (await res.json()) as SchoolPackage;
    expect(pkg.school.name).toBe("Northview High School");
    expect(pkg.candidates.length).toBeGreaterThan(20);

    const base = { radiusM: 800, periodYears: 3, crashFilter: "all", scenario: "standard" } as const;
    const std = runAnalysis(pkg, base);
    expect(std.population).toBeGreaterThan(20);
    expect(std.candidates[0]!.rank).toBe(1);
    expect(std.candidates.every((s) => Number.isFinite(s.priority) && s.priority >= 0 && s.priority <= 100)).toBe(true);

    // controls change real output
    expect(runAnalysis(pkg, { ...base, radiusM: 1200 }).population).toBeGreaterThan(std.population);
    expect(runAnalysis(pkg, { ...base, radiusM: 400 }).population).toBeLessThan(std.population);
    expect(runAnalysis(pkg, { ...base, crashFilter: "pedestrian" }).matchedCrashes).toBeLessThan(std.matchedCrashes);
    const ped = runAnalysis(pkg, { ...base, scenario: "pedestrian" });
    expect(ped.candidates.map((s) => s.priority)).not.toEqual(std.candidates.map((s) => s.priority));

    // Resource Planner returns exactly the requested distinct locations, in rank order
    const plan = planReviews(std, 5);
    expect(plan.selections).toHaveLength(5);
    expect(plan.selections.map((s) => s.scored.rank)).toEqual([...plan.selections.map((s) => s.scored.rank)].sort((a, b) => a - b));
    expect(new Set(plan.selections.map((s) => s.scored.candidate.id)).size).toBe(5);
  });

  it("publishes sources, quality and validation in /api/meta", async () => {
    const body = (await (await getMeta()).json()) as {
      meta: { sources: { publisher: string }[]; quality: { crashesClean: number } };
      validation: { experiments: { id: string }[] } | null;
      storage: string;
    };
    expect(body.meta.sources.some((s) => s.publisher.includes("Georgia Department of Transportation"))).toBe(true);
    expect(body.meta.quality.crashesClean).toBeGreaterThan(500_000);
    expect(body.validation?.experiments.map((e) => e.id)).toContain("hin_agreement");
    expect(body.storage).toBe("files");
  });
});
