import { CRASH_FLAG, periodWindow, runAnalysis } from "@crossmetric/engine";
import type { AnalysisConfiguration, AnalysisResult, PriorityBandId, SchoolPackage } from "@crossmetric/engine";

/** The analysis every institution page and comparison uses: the Analyze defaults. */
export const DEFAULT_ANALYSIS: AnalysisConfiguration = { radiusM: 800, periodYears: 3, crashFilter: "all", scenario: "standard" };

export interface InstitutionSummary {
  id: string;
  name: string;
  type: "k12" | "college";
  result: AnalysisResult;
  locations: number;
  bandCounts: Record<PriorityBandId, number>;
  crashes: { all: number; injury: number; fatal: number; pedestrian: number; bicyclist: number; lowLight: number };
  monthly: { month: string; crashes: number }[];
  top: { id: string; name: string; kind: "intersection" | "segment"; priority: number; band: PriorityBandId; crashes: number; pedestrian: number }[];
  infrastructure: {
    intersections: number;
    signalized: number;
    segmentKm: number;
    arterialShare: number;
    multilaneShare: number;
    trafficMeasuredShare: number;
    busiestAadt: number | null;
  };
}

/** Facts about the roads within 800 m of an institution, all from its analysis package. */
export function summarizeInstitution(pkg: SchoolPackage): InstitutionSummary {
  const result = runAnalysis(pkg, DEFAULT_ANALYSIS);
  const inside = new Set(result.candidates.map((s) => s.index));
  const { startDay } = periodWindow(pkg, DEFAULT_ANALYSIS.periodYears);
  const c = pkg.crashes;
  const crashes = { all: 0, injury: 0, fatal: 0, pedestrian: 0, bicyclist: 0, lowLight: 0 };
  const byMonth = new Map<string, number>();
  const start = Date.parse(`${pkg.window.start}T00:00:00Z`);
  for (let i = 0; i < c.candidate.length; i++) {
    if (!inside.has(c.candidate[i]!) || c.day[i]! < startDay) continue;
    const f = c.flags[i]!;
    crashes.all++;
    if (f & CRASH_FLAG.injury) crashes.injury++;
    if (f & CRASH_FLAG.fatal) crashes.fatal++;
    if (f & CRASH_FLAG.pedestrian) crashes.pedestrian++;
    if (f & CRASH_FLAG.bicyclist) crashes.bicyclist++;
    if (f & CRASH_FLAG.lowLight) crashes.lowLight++;
    const month = new Date(start + c.day[i]! * 86_400_000).toISOString().slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + 1);
  }
  const months: { month: string; crashes: number }[] = [];
  const s = new Date(start);
  const end = Date.parse(`${pkg.window.end}T00:00:00Z`);
  for (let d = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), 1)); d.getTime() <= end; d.setUTCMonth(d.getUTCMonth() + 1)) {
    const key = d.toISOString().slice(0, 7);
    months.push({ month: key, crashes: byMonth.get(key) ?? 0 });
  }

  let segM = 0;
  let arterialM = 0;
  let multilaneM = 0;
  let measuredM = 0;
  let intersections = 0;
  let signalized = 0;
  let busiest: number | null = null;
  for (const s2 of result.candidates) {
    const cand = s2.candidate;
    if (cand.traffic.aadt !== null) busiest = Math.max(busiest ?? 0, cand.traffic.aadt);
    if (cand.kind === "intersection") {
      intersections++;
      if (cand.signal === "gdot-permitted") signalized++;
      continue;
    }
    const len = cand.lengthM ?? 0;
    segM += len;
    if (cand.functionalClass <= 4) arterialM += len;
    if ((cand.lanes ?? 0) >= 4) multilaneM += len;
    if (cand.traffic.aadt !== null) measuredM += len;
  }
  return {
    id: pkg.school.id,
    name: pkg.school.name,
    type: pkg.school.institutionType === "college" ? "college" : "k12",
    result,
    locations: result.population,
    bandCounts: result.bandCounts,
    crashes,
    monthly: months,
    top: result.candidates.slice(0, 5).map((x) => ({
      id: x.candidate.id,
      name: x.candidate.name,
      kind: x.candidate.kind,
      priority: x.displayPriority,
      band: x.band.id,
      crashes: x.features.crashes,
      pedestrian: x.features.pedestrianCrashes,
    })),
    infrastructure: {
      intersections,
      signalized,
      segmentKm: segM / 1000,
      arterialShare: segM > 0 ? arterialM / segM : 0,
      multilaneShare: segM > 0 ? multilaneM / segM : 0,
      trafficMeasuredShare: segM > 0 ? measuredM / segM : 0,
      busiestAadt: busiest,
    },
  };
}

export interface ThumbData {
  center: [number, number];
  radiusM: number;
  lines: { c: [number, number][]; b: PriorityBandId }[];
  points: { c: [number, number]; b: PriorityBandId }[];
}

/** Compact geometry for an institution thumbnail: the analyzed roads colored by Priority for Review band. */
export function thumbData(pkg: SchoolPackage): ThumbData {
  const result = runAnalysis(pkg, DEFAULT_ANALYSIS);
  const r5 = (v: number) => Math.round(v * 1e5) / 1e5;
  const lines: ThumbData["lines"] = [];
  const points: ThumbData["points"] = [];
  for (const s of result.candidates) {
    const g = s.candidate.geometry;
    if (g.type === "LineString") lines.push({ c: g.coordinates.map(([x, y]) => [r5(x), r5(y)] as [number, number]), b: s.band.id });
    else points.push({ c: [r5(g.coordinates[0]), r5(g.coordinates[1])], b: s.band.id });
  }
  return { center: [pkg.school.lon, pkg.school.lat], radiusM: DEFAULT_ANALYSIS.radiusM, lines, points };
}
