import { CRASH_FLAG } from "./types";
import type {
  AnalysisConfiguration,
  CandidateFeatures,
  CrashFilterId,
  CrashRecord,
  PeriodYears,
  SchoolPackage,
} from "./types";

const DAY_MS = 86_400_000;

function parseDate(iso: string): number {
  // Dates are calendar days; anchor at UTC noon to stay clear of DST edges.
  return Date.parse(`${iso}T12:00:00Z`);
}

export function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Calendar month arithmetic that clamps to the last valid day
 * (Mar 31 - 1 month = Feb 28/29), matching Python's dateutil.relativedelta.
 */
export function addMonthsClamped(ms: number, months: number): number {
  const d = new Date(ms);
  const total = d.getUTCFullYear() * 12 + d.getUTCMonth() + months;
  const year = Math.floor(total / 12);
  const month = total - year * 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Date.UTC(year, month, Math.min(d.getUTCDate(), lastDay), 12);
}

/**
 * The period window: the most recent `months` months ending on the package
 * window's last day (never earlier than the package window's first day).
 */
export function periodWindow(pkg: SchoolPackage, periodYears: PeriodYears): { start: string; end: string; startDay: number } {
  const startCandidate = addMonthsClamped(parseDate(pkg.window.end), -periodYears * 12) + DAY_MS;
  const pkgStart = parseDate(pkg.window.start);
  const startMs = Math.max(startCandidate, pkgStart);
  const startDay = Math.round((startMs - pkgStart) / DAY_MS);
  return { start: isoDate(startMs), end: pkg.window.end, startDay };
}

export function crashMatchesFilter(flags: number, filter: CrashFilterId): boolean {
  switch (filter) {
    case "all":
      return true;
    case "injury":
      return (flags & CRASH_FLAG.injury) !== 0;
    case "pedestrian":
      return (flags & CRASH_FLAG.pedestrian) !== 0;
    case "lowLight":
      return (flags & CRASH_FLAG.lowLight) !== 0;
  }
}

/** Raw indicator values for every candidate in the package (radius not applied). */
export function computeFeatures(pkg: SchoolPackage, config: Pick<AnalysisConfiguration, "periodYears" | "crashFilter">): CandidateFeatures[] {
  const features: CandidateFeatures[] = pkg.candidates.map((c) => ({
    crashes: 0,
    injuryCrashes: 0,
    fatalCrashes: 0,
    pedestrianCrashes: 0,
    bicyclistCrashes: 0,
    lowLightCrashes: 0,
    aadt: c.traffic.aadt,
    distanceM: c.distanceM,
  }));
  const { startDay } = periodWindow(pkg, config.periodYears);
  const { candidate, day, flags } = pkg.crashes;
  for (let i = 0; i < candidate.length; i++) {
    const d = day[i] as number;
    const f = flags[i] as number;
    if (d < startDay || !crashMatchesFilter(f, config.crashFilter)) continue;
    const feat = features[candidate[i] as number];
    if (!feat) continue;
    feat.crashes += 1;
    if (f & CRASH_FLAG.injury) feat.injuryCrashes += 1;
    if (f & CRASH_FLAG.fatal) feat.fatalCrashes += 1;
    if (f & CRASH_FLAG.pedestrian) feat.pedestrianCrashes += 1;
    if (f & CRASH_FLAG.bicyclist) feat.bicyclistCrashes += 1;
    if (f & CRASH_FLAG.lowLight) feat.lowLightCrashes += 1;
  }
  return features;
}

/** Decoded crash records for one candidate under the current period and filter, newest first. */
export function crashesForCandidate(
  pkg: SchoolPackage,
  candidateIndex: number,
  config: Pick<AnalysisConfiguration, "periodYears" | "crashFilter">,
): CrashRecord[] {
  const { startDay } = periodWindow(pkg, config.periodYears);
  const start = parseDate(pkg.window.start);
  const c = pkg.crashes;
  const out: CrashRecord[] = [];
  const candidateId = pkg.candidates[candidateIndex]?.id ?? "";
  for (let i = 0; i < c.candidate.length; i++) {
    if (c.candidate[i] !== candidateIndex) continue;
    const d = c.day[i] as number;
    const f = c.flags[i] as number;
    if (d < startDay || !crashMatchesFilter(f, config.crashFilter)) continue;
    out.push({
      id: c.id[i] as string,
      candidateId,
      date: isoDate(start + d * DAY_MS),
      injury: (f & CRASH_FLAG.injury) !== 0,
      fatal: (f & CRASH_FLAG.fatal) !== 0,
      pedestrian: (f & CRASH_FLAG.pedestrian) !== 0,
      bicyclist: (f & CRASH_FLAG.bicyclist) !== 0,
      lowLight: (f & CRASH_FLAG.lowLight) !== 0,
      collision: c.collision[i] as number,
      light: c.light[i] as number,
      lon: c.lon[i] as number,
      lat: c.lat[i] as number,
    });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id.localeCompare(b.id)));
}
