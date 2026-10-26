/**
 * Types for the statewide files written by the pipeline (pipeline/run.py):
 * index.json, meta.json and validation.json. Per-school packages use
 * `SchoolPackage` from @crossmetric/engine.
 */
import type { DataSourceMetadata, ValidationResult } from "@crossmetric/engine";

/** [id, name, city, district, level, lon, lat, candidates800, crashes1200] */
export type SchoolIndexRow = [string, string, string | null, string | null, string | null, number, number, number, number];

export interface SchoolIndex {
  generatedAt: string;
  modelVersion: string;
  window: { start: string; end: string };
  fields: string[];
  schools: SchoolIndexRow[];
  /** Other names people search for, by id (colleges: IPEDS IALIAS, e.g. "Georgia Tech"). */
  aliases?: Record<string, string>;
}

export type InstitutionType = "k12" | "college";

export interface SchoolSummary {
  id: string;
  /** "college" for IPEDS institutions; "k12" for NCES public schools. */
  type?: InstitutionType;
  /** Other names the institution is known by. */
  aliases?: string[];
  name: string;
  city: string | null;
  district: string | null;
  level: string | null;
  lon: number;
  lat: number;
  candidates800: number;
  crashes1200: number;
}

export function toSummary(row: SchoolIndexRow, type: InstitutionType = "k12", alias?: string): SchoolSummary {
  const [id, name, city, district, level, lon, lat, candidates800, crashes1200] = row;
  const summary: SchoolSummary = { id, type, name, city, district, level, lon, lat, candidates800, crashes1200 };
  if (alias) summary.aliases = splitAliases(alias);
  return summary;
}

/** IPEDS lists several aliases in one field, separated by commas, semicolons, "or" or wide gaps. */
export function splitAliases(raw: string): string[] {
  return raw
    .split(/[;,|]|\s{2,}|\s+or\s+/i)
    .map((a) => a.trim())
    .filter((a) => a.length >= 2);
}

export interface CleaningRow {
  reason: string;
  description: string;
  records: number;
}

export interface PublishedMeta {
  generatedAt: string;
  dataSnapshot: string;
  modelVersion: string;
  window: { start: string; end: string; months: number };
  sources: DataSourceMetadata[];
  labels: { collision: string[]; light: string[] };
  quality: {
    crashCleaning: CleaningRow[];
    crashesRaw: number;
    crashesBeforeWindow: number;
    crashesClean: number;
    association: Record<string, number>;
    associationReasons: Record<string, string>;
    schoolsQuarantined: Record<string, number>;
    candidates: number;
    intersections: number;
    segments: number;
    trafficCoverage: Record<string, number>;
    unnamedCandidates: number;
    monthlyCrashes: { month: string; crashes: number }[];
  };
  ruleDescriptions: Record<string, string>;
}

export interface ValidationReport {
  generatedAt: string;
  modelVersion: string;
  experiments: ValidationResult[];
}
