/**
 * CrossMetric 2.0 API integration tests on the real published data
 * (data/published, including colleges and statewide indexes). Skipped when the
 * pipeline outputs are missing. None of these call external services.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, describe, expect, it } from "vitest";
import { GET as institutions } from "@/app/api/institutions/route";
import { POST as point } from "@/app/api/map/point/route";
import { GET as mapLayer } from "@/app/api/map/[layer]/route";
import { GET as crashes } from "@/app/api/map/crashes/route";
import { GET as listReports, POST as createReport } from "@/app/api/reports/route";
import { POST as voteReport } from "@/app/api/reports/[id]/route";
import { GET as getSchool } from "@/app/api/schools/[id]/route";
import { GET as thumb } from "@/app/api/schools/[id]/thumb/route";
import { GET as search } from "@/app/api/schools/search/route";
import { POST as trips } from "@/app/api/trips/route";
import { summarizeInstitution } from "@/lib/institution-summary";
import type { CommunityReport } from "@/lib/reports";
import type { SchoolPackage } from "@crossmetric/engine";

const published = path.resolve(process.cwd(), "..", "..", "data", "published");
const hasColleges = existsSync(path.join(published, "colleges.json"));
const hasStatewide = existsSync(path.join(published, "statewide", "manifest.json"));
const GEORGIA_TECH = "139755";
const NORTHVIEW = "130228002560";

const json = (body: unknown) => new Request("http://localhost", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const params = <T>(p: T) => ({ params: Promise.resolve(p) });

describe.skipIf(!hasColleges)("colleges", () => {
  it("serves a college package through the same API as schools", async () => {
    const res = await getSchool(new Request("http://localhost"), params({ id: GEORGIA_TECH }));
    expect(res.status).toBe(200);
    const pkg = (await res.json()) as SchoolPackage;
    expect(pkg.school.name).toMatch(/Georgia Institute of Technology/);
    expect(pkg.school.institutionType).toBe("college");
    const summary = summarizeInstitution(pkg);
    expect(summary.locations).toBeGreaterThan(20);
    expect(summary.crashes.all).toBeGreaterThan(summary.crashes.pedestrian);
    expect(summary.monthly.length).toBeGreaterThanOrEqual(30);
  });

  it("finds colleges in search and lists every institution with its type", async () => {
    const res = await search(new NextRequest("http://localhost/api/schools/search?q=georgia%20tech&type=college"));
    const body = (await res.json()) as { results: { id: string; type: string }[] };
    expect(body.results[0]).toMatchObject({ id: GEORGIA_TECH, type: "college" });
    const all = (await (await institutions()).json()) as { rows: [string, string][] };
    expect(all.rows.some(([id, type]) => id === NORTHVIEW && type === "k12")).toBe(true);
    expect(all.rows.filter(([, type]) => type === "college").length).toBeGreaterThan(80);
  });

  it("builds an institution thumbnail from analyzed roads", async () => {
    const res = await thumb(new Request("http://localhost"), params({ id: NORTHVIEW }));
    const body = (await res.json()) as { lines: unknown[]; radiusM: number };
    expect(res.status).toBe(200);
    expect(body.radiusM).toBe(800);
    expect(body.lines.length).toBeGreaterThan(5);
    expect((await thumb(new Request("http://localhost"), params({ id: "../x" }))).status).toBe(400);
  });
});

describe.skipIf(!hasStatewide)("statewide intelligence", () => {
  it("describes a point: road, crashes nearby, setting", async () => {
    // Peachtree St NE at 10th St NE, Midtown Atlanta
    const res = await point(json({ lon: -84.38522, lat: 33.78165 }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { road: { label: string } | null; crashes: { all: number }; setting: { id: string } };
    expect(body.road).not.toBeNull();
    expect(body.crashes.all).toBeGreaterThan(0);
    expect(["busy", "veryBusy", "urbanCore"]).toContain(body.setting.id);
    expect((await point(json({ lon: -118.2, lat: 34 }))).status).toBe(400);
  });

  it("serves crash points only for small areas", async () => {
    const ok = await crashes(new NextRequest("http://localhost/api/map/crashes?bbox=-84.39,33.775,-84.38,33.785"));
    const body = (await ok.json()) as { lon: number[]; flags: number[] };
    expect(ok.status).toBe(200);
    expect(body.lon.length).toBeGreaterThan(10);
    expect((await crashes(new NextRequest("http://localhost/api/map/crashes?bbox=-85,33,-84,34"))).status).toBe(400);
  });

  it("serves map layers by name only", async () => {
    expect((await mapLayer(new Request("http://localhost"), params({ layer: "hin" }))).status).toBe(200);
    expect((await mapLayer(new Request("http://localhost"), params({ layer: "../../secrets" }))).status).toBe(404);
  });

  it("validates trip requests before calling any routing service", async () => {
    expect((await trips(json({ from: { lon: -84.39, lat: 33.77 }, to: { lon: -118, lat: 34 }, mode: "walk" }))).status).toBe(400);
    expect((await trips(json({ from: { lon: -84.39, lat: 33.77 }, to: { lon: -84.38, lat: 33.78 }, mode: "fly" }))).status).toBe(400);
    expect((await trips(json({ from: { lon: -84.39, lat: 33.77 }, to: { lon: -84.39, lat: 33.77 }, mode: "walk" }))).status).toBe(400);
  });
});

describe("community reports store", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cm-reports-"));
  process.env.COMMUNITY_DATA_DIR = dir;
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("creates, lists and votes on an anonymous report", async () => {
    const created = await createReport(json({ category: "missing_sidewalk", description: "Sidewalk ends at the bridge.", lon: -84.39, lat: 33.77, locationLabel: "Test St" }));
    expect(created.status).toBe(201);
    const { report } = (await created.json()) as { report: CommunityReport };
    expect(report).toMatchObject({ category: "missing_sidewalk", confirmations: 0, resolvedVotes: 0 });
    expect(Object.keys(report).sort()).toEqual(["category", "confirmations", "createdAt", "description", "id", "lat", "locationLabel", "lon", "resolvedVotes"]);

    const listed = (await (await listReports(new NextRequest("http://localhost/api/reports"))).json()) as { reports: CommunityReport[] };
    expect(listed.reports.map((r) => r.id)).toContain(report.id);

    const voted = await voteReport(json({ vote: "confirm" }), params({ id: report.id }));
    expect(((await voted.json()) as { report: CommunityReport }).report.confirmations).toBe(1);
    expect((await voteReport(json({ vote: "confirm" }), params({ id: "not-a-uuid" }))).status).toBe(400);
  });

  it("rejects invalid reports", async () => {
    const bad = await createReport(json({ category: "missing_sidewalk", lon: -84.39, lat: 33.77, description: "email me at a@b.co" }));
    expect(bad.status).toBe(400);
  });
});
