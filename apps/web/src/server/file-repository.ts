import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SchoolPackage } from "@crossmetric/engine";
import type { PublishedMeta, SchoolIndex, ValidationReport } from "@/lib/published";
import type { CrossMetricRepository } from "./repository";
import { IPEDS_ID, NCES_ID } from "./repository";

function dataDir(): string {
  return process.env.CROSSMETRIC_DATA_DIR ?? path.resolve(process.cwd(), "..", "..", "data", "published");
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf-8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export class FileRepository implements CrossMetricRepository {
  readonly kind = "files" as const;
  private index: Promise<SchoolIndex> | null = null;
  private meta: Promise<PublishedMeta> | null = null;
  private colleges: Promise<SchoolIndex | null> | null = null;

  getSchoolIndex(): Promise<SchoolIndex> {
    this.index ??= readJson<SchoolIndex>(path.join(dataDir(), "index.json")).then((v) => {
      if (!v) throw new Error(`CrossMetric data not found in ${dataDir()}. Run: python -m pipeline.run`);
      return v;
    });
    return this.index;
  }

  getCollegeIndex(): Promise<SchoolIndex | null> {
    this.colleges ??= readJson<SchoolIndex>(path.join(dataDir(), "colleges.json"));
    return this.colleges;
  }

  async getSchoolPackage(schoolId: string): Promise<SchoolPackage | null> {
    // The id patterns also prevent path traversal.
    if (NCES_ID.test(schoolId)) return readJson<SchoolPackage>(path.join(dataDir(), "schools", `${schoolId}.json`));
    if (IPEDS_ID.test(schoolId)) return readJson<SchoolPackage>(path.join(dataDir(), "colleges", `${schoolId}.json`));
    return null;
  }

  getMeta(): Promise<PublishedMeta> {
    this.meta ??= readJson<PublishedMeta>(path.join(dataDir(), "meta.json")).then((v) => {
      if (!v) throw new Error(`meta.json not found in ${dataDir()}`);
      return v;
    });
    return this.meta;
  }

  getValidation(): Promise<ValidationReport | null> {
    return readJson<ValidationReport>(path.join(dataDir(), "validation.json"));
  }
}
