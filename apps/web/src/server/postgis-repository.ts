import "server-only";

import postgres from "postgres";
import type { CandidateLocation, SchoolPackage, ValidationResult } from "@crossmetric/engine";
import type { PublishedMeta, SchoolIndex, SchoolIndexRow, ValidationReport } from "@/lib/published";
import { FileRepository } from "./file-repository";
import type { CrossMetricRepository } from "./repository";
import { IPEDS_ID, NCES_ID } from "./repository";

const COLLISION_CODES = [
  "01-Angle",
  "02-Head On",
  "03-Rear End",
  "04-Sideswipe-Same Direction",
  "05-Sideswipe-Opposite Direction",
  "06-Not A Collision with Motor Vehicle",
];
const LIGHT_CODES = ["daylight", "dawn", "dusk", "dark_lighted", "dark_unlighted"];
const FLAG = { injury: 1, fatal: 2, pedestrian: 4, bicyclist: 8, lowLight: 16 };
const DAY_MS = 86_400_000;

interface CandidateRow {
  id: string;
  kind: "intersection" | "segment";
  name: string;
  context: string | null;
  roads: string[];
  functional_class: number;
  lanes: number | null;
  length_m: number | null;
  legs: number | null;
  signalized: boolean | null;
  aadt: number | null;
  aadt_year: number | null;
  aadt_status: "measured" | "partial" | "unavailable";
  aadt_roads_counted: number;
  aadt_roads_total: number;
  distance_m: number;
  geojson: string;
}

interface CrashRow {
  crash_id: string;
  candidate_id: string;
  crash_date: Date;
  injury_or_fatal: boolean;
  fatal: boolean;
  pedestrian: boolean;
  bicyclist: boolean;
  low_light: boolean;
  collision_type: string | null;
  light: string;
  lon: number;
  lat: number;
}

/**
 * Reads CrossMetric data from Supabase PostgreSQL + PostGIS and assembles the
 * same SchoolPackage the file repository serves, so the engine and UI behave
 * identically in both modes.
 */
export class PostgisRepository implements CrossMetricRepository {
  readonly kind = "postgis" as const;
  private sql: postgres.Sql;

  // Colleges are published as files only (pipeline/institutions.py); they are not loaded into PostGIS yet.
  private files = new FileRepository();

  constructor(url: string) {
    this.sql = postgres(url, { max: 5, idle_timeout: 20, prepare: false });
  }

  getCollegeIndex(): Promise<SchoolIndex | null> {
    return this.files.getCollegeIndex();
  }

  private async latestRun(): Promise<{ meta: PublishedMeta; window_start: Date; window_end: Date; generated_at: Date; model_version: string }> {
    const [run] = await this.sql<{ meta: PublishedMeta; window_start: Date; window_end: Date; generated_at: Date; model_version: string }[]>`
      select meta, window_start, window_end, generated_at, model_version
      from pipeline_runs order by generated_at desc limit 1`;
    if (!run) throw new Error("No pipeline run has been loaded into PostGIS. Run: python -m pipeline.publish.postgis");
    return run;
  }

  async getSchoolIndex(): Promise<SchoolIndex> {
    const run = await this.latestRun();
    const rows = await this.sql<{ id: string; name: string; city: string | null; district: string | null; level: string | null; lon: number; lat: number; candidates_800: number; crashes_1200: number }[]>`
      select id, name, city, district, level,
             round(st_x(geom::geometry)::numeric, 6)::float8 as lon,
             round(st_y(geom::geometry)::numeric, 6)::float8 as lat,
             candidates_800, crashes_1200
      from schools order by id`;
    return {
      generatedAt: run.generated_at.toISOString(),
      modelVersion: run.model_version,
      window: { start: iso(run.window_start), end: iso(run.window_end) },
      fields: ["id", "name", "city", "district", "level", "lon", "lat", "candidates800", "crashes1200"],
      schools: rows.map((r): SchoolIndexRow => [r.id, r.name, r.city, r.district, r.level, r.lon, r.lat, r.candidates_800, r.crashes_1200]),
    };
  }

  async getSchoolPackage(schoolId: string): Promise<SchoolPackage | null> {
    if (IPEDS_ID.test(schoolId)) return this.files.getSchoolPackage(schoolId);
    if (!NCES_ID.test(schoolId)) return null;
    const [school] = await this.sql`
      select id, name, district, city, county, street, zip, level, grade_low, grade_high, school_type, school_year, quality,
             round(st_x(geom::geometry)::numeric, 6)::float8 as lon,
             round(st_y(geom::geometry)::numeric, 6)::float8 as lat
      from schools where id = ${schoolId}`;
    if (!school) return null;
    const run = await this.latestRun();

    const cands = await this.sql<CandidateRow[]>`
      select c.id, c.kind, c.name, c.context, c.roads, c.functional_class, c.lanes, c.length_m, c.legs, c.signalized,
             c.aadt, c.aadt_year, c.aadt_status, c.aadt_roads_counted, c.aadt_roads_total,
             sc.distance_m, st_asgeojson(c.geom, 6) as geojson
      from school_candidates sc join candidate_locations c on c.id = sc.candidate_id
      where sc.school_id = ${schoolId}
      order by sc.distance_m, c.id`;
    const index = new Map(cands.map((c, i) => [c.id, i]));
    const crashes = cands.length
      ? await this.sql<CrashRow[]>`
          select crash_id, candidate_id, crash_date, injury_or_fatal, fatal, pedestrian, bicyclist, low_light,
                 collision_type, light,
                 round(st_x(geom::geometry)::numeric, 5)::float8 as lon,
                 round(st_y(geom::geometry)::numeric, 5)::float8 as lat
          from crashes
          where candidate_id in ${this.sql(cands.map((c) => c.id))}
            and crash_date between ${run.window_start} and ${run.window_end}
          order by crash_date, crash_id`
      : [];

    const start = Date.UTC(run.window_start.getUTCFullYear(), run.window_start.getUTCMonth(), run.window_start.getUTCDate());
    const candidates: CandidateLocation[] = cands.map((c) => ({
      id: c.id,
      kind: c.kind,
      name: c.name,
      context: c.context,
      roads: c.roads,
      distanceM: Math.round(c.distance_m * 10) / 10,
      functionalClass: c.functional_class,
      lanes: c.lanes,
      lengthM: c.length_m === null ? null : Math.round(c.length_m * 10) / 10,
      legs: c.legs,
      signal: c.signalized ? "gdot-permitted" : "no-record",
      traffic: { aadt: c.aadt, year: c.aadt_year, status: c.aadt_status, roadsCounted: c.aadt_roads_counted, roadsTotal: c.aadt_roads_total },
      geometry: JSON.parse(c.geojson) as CandidateLocation["geometry"],
    }));
    return {
      schemaVersion: 1,
      modelVersion: run.model_version,
      generatedAt: run.generated_at.toISOString(),
      school: {
        id: school.id,
        name: school.name,
        district: school.district,
        city: school.city,
        county: school.county,
        street: school.street,
        zip: school.zip,
        level: school.level,
        gradeLow: school.grade_low,
        gradeHigh: school.grade_high,
        schoolType: school.school_type,
        schoolYear: school.school_year,
        lon: school.lon,
        lat: school.lat,
      },
      window: { start: iso(run.window_start), end: iso(run.window_end) },
      candidates,
      crashes: {
        id: crashes.map((k) => k.crash_id),
        candidate: crashes.map((k) => index.get(k.candidate_id) ?? -1),
        day: crashes.map((k) => Math.round((Date.UTC(k.crash_date.getUTCFullYear(), k.crash_date.getUTCMonth(), k.crash_date.getUTCDate()) - start) / DAY_MS)),
        flags: crashes.map(
          (k) =>
            (k.injury_or_fatal ? FLAG.injury : 0) |
            (k.fatal ? FLAG.fatal : 0) |
            (k.pedestrian ? FLAG.pedestrian : 0) |
            (k.bicyclist ? FLAG.bicyclist : 0) |
            (k.low_light ? FLAG.lowLight : 0),
        ),
        collision: crashes.map((k) => {
          const i = k.collision_type ? COLLISION_CODES.indexOf(k.collision_type) : -1;
          return i < 0 ? COLLISION_CODES.length : i;
        }),
        light: crashes.map((k) => {
          const i = LIGHT_CODES.indexOf(k.light);
          return i < 0 ? LIGHT_CODES.length : i;
        }),
        lon: crashes.map((k) => k.lon),
        lat: crashes.map((k) => k.lat),
      },
      quality: school.quality,
    };
  }

  async getMeta(): Promise<PublishedMeta> {
    return (await this.latestRun()).meta;
  }

  async getValidation(): Promise<ValidationReport | null> {
    const rows = await this.sql<{ experiment: string; title: string; reference: string; description: string; metrics: ValidationResult["metrics"]; run_at: Date; model_version: string }[]>`
      select distinct on (experiment) experiment, title, reference, description, metrics, run_at, model_version
      from validation_runs order by experiment, run_at desc`;
    if (!rows.length) return null;
    return {
      generatedAt: rows[0]!.run_at.toISOString(),
      modelVersion: rows[0]!.model_version,
      experiments: rows.map((r) => ({ id: r.experiment, title: r.title, reference: r.reference, description: r.description, metrics: r.metrics })),
    };
  }
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
