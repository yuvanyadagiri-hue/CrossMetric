import type { ClassOccurrence } from "@crossmetric/engine/commute";
import type { ImportedSeries } from "./commute-store";

// Kept apart from the .ics parser so the app does not load ical.js until a calendar is imported.
/** Re-apply a series' building choice (or inclusion) to its occurrences. */
export function applySeries(occ: ClassOccurrence[], series: ImportedSeries[]): ClassOccurrence[] {
  const byUid = new Map(series.map((s) => [s.uid, s]));
  return occ.map((o) => {
    const s = byUid.get(o.sourceRef);
    if (!s) return o;
    return { ...o, buildingId: s.buildingId, needsLocation: !s.buildingId, include: s.include };
  });
}
