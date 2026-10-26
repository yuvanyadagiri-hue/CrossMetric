import "server-only";

import type { SchoolPackage } from "@crossmetric/engine";
import type { PublishedMeta, SchoolIndex, ValidationReport } from "@/lib/published";
import { FileRepository } from "./file-repository";
import { PostgisRepository } from "./postgis-repository";

/**
 * Where CrossMetric reads analysis data from.
 *
 * Both implementations return identical shapes:
 *  - FileRepository reads the pipeline's published JSON (data/published).
 *  - PostgisRepository reads the same data from Supabase PostgreSQL + PostGIS
 *    (supabase/migrations) and is used whenever DATABASE_URL is set.
 */
export interface CrossMetricRepository {
  readonly kind: "files" | "postgis";
  /** Georgia public K-12 schools (NCES). */
  getSchoolIndex(): Promise<SchoolIndex>;
  /** Georgia degree-granting colleges and universities (IPEDS); null if that pipeline step has not run. */
  getCollegeIndex(): Promise<SchoolIndex | null>;
  /** Analysis package for a school (12-digit NCES id) or college (6-digit IPEDS unit id). */
  getSchoolPackage(schoolId: string): Promise<SchoolPackage | null>;
  getMeta(): Promise<PublishedMeta>;
  getValidation(): Promise<ValidationReport | null>;
}

let repository: CrossMetricRepository | null = null;

export function getRepository(): CrossMetricRepository {
  if (!repository) {
    const url = process.env.DATABASE_URL;
    repository = url ? new PostgisRepository(url) : new FileRepository();
  }
  return repository;
}

export const NCES_ID = /^\d{12}$/;
export const IPEDS_ID = /^\d{6}$/;
/** Any institution id CrossMetric serves: NCES school id or IPEDS unit id. */
export const INSTITUTION_ID = /^(\d{12}|\d{6})$/;
