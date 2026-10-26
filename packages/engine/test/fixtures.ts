/**
 * SYNTHETIC TEST FIXTURES — not real data.
 *
 * Small hand-built packages whose correct answers can be worked out by hand.
 * They exist only for unit tests and are never shown in the app.
 */
import type { CandidateLocation, SchoolPackage } from "../src/types";
import { CRASH_FLAG } from "../src/types";

export function candidate(id: string, overrides: Partial<CandidateLocation> = {}): CandidateLocation {
  return {
    id,
    kind: "intersection",
    name: `Test Rd ${id} & Example St`,
    context: null,
    roads: [`Test Rd ${id}`, "Example St"],
    distanceM: 100,
    functionalClass: 4,
    lanes: null,
    lengthM: null,
    legs: 4,
    signal: "no-record",
    traffic: { aadt: 10000, year: 2023, status: "measured", roadsCounted: 2, roadsTotal: 2 },
    geometry: { type: "Point", coordinates: [-84.2, 34.0] },
    ...overrides,
  };
}

export interface CrashSpec {
  candidate: number;
  day: number;
  injury?: boolean;
  fatal?: boolean;
  pedestrian?: boolean;
  lowLight?: boolean;
}

export function pkg(candidates: CandidateLocation[], crashes: CrashSpec[] = []): SchoolPackage {
  return {
    schemaVersion: 1,
    modelVersion: "1.0.0",
    generatedAt: "2026-10-03T00:00:00Z",
    school: {
      id: "000000000000",
      name: "Synthetic Test School",
      district: "Test District",
      city: "Testville",
      county: null,
      street: null,
      zip: null,
      level: "High",
      gradeLow: "09",
      gradeHigh: "12",
      schoolType: null,
      schoolYear: "2024-2025",
      lon: -84.2,
      lat: 34.0,
    },
    window: { start: "2023-10-02", end: "2026-10-01" },
    candidates,
    crashes: {
      id: crashes.map((_, i) => `T${i}`),
      candidate: crashes.map((c) => c.candidate),
      day: crashes.map((c) => c.day),
      flags: crashes.map(
        (c) =>
          (c.injury || c.fatal ? CRASH_FLAG.injury : 0) |
          (c.fatal ? CRASH_FLAG.fatal : 0) |
          (c.pedestrian ? CRASH_FLAG.pedestrian : 0) |
          (c.lowLight ? CRASH_FLAG.lowLight : 0),
      ),
      collision: crashes.map(() => 0),
      light: crashes.map(() => 0),
      lon: crashes.map(() => -84.2),
      lat: crashes.map(() => 34.0),
    },
    quality: { recordedNearby: crashes.length, assigned: crashes.length, off_network: 0, limited_access: 0, ramp: 0, no_candidate: 0 },
  };
}

/** n crashes on one candidate, all on `day`. */
export function many(candidateIndex: number, n: number, extra: Omit<CrashSpec, "candidate" | "day"> = {}, day = 900): CrashSpec[] {
  return Array.from({ length: n }, () => ({ candidate: candidateIndex, day, ...extra }));
}
