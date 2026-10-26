import "server-only";

import { computeCrossScore, type TravelMode } from "@crossmetric/engine";
import type { LonLat } from "@/lib/commute-types";
import type { SafetySummary } from "@/lib/journey-types";
import { measureRoute } from "../route-analysis";
import { getStatewide } from "../statewide";
import { traceAttributes } from "../valhalla";

/**
 * CrossScore for the street part of a journey (walking, biking or driving), from
 * statewide GDOT crash records, road inventory and OpenStreetMap attributes.
 * It describes conditions along the route; it does not predict crashes or call a
 * route safe. Transit rides are never scored. Returns null when the data or the
 * attribute service is unavailable, so a missing score is never shown as a good one.
 */
export async function streetSafety(mode: TravelMode, shape: LonLat[], durationS: number): Promise<SafetySummary | null> {
  if (shape.length < 2) return null;
  try {
    const sw = await getStatewide();
    const edges = await traceAttributes(mode, shape)
      .then((r) => r.edges)
      .catch(() => null);
    const m = measureRoute(sw, mode, shape, durationS, edges);
    const r = computeCrossScore(m.conditions, sw.manifest.references);
    return { score: r.score, band: r.band.label, mode, confidence: r.confidence.level, concern: r.concerns[0] ?? null };
  } catch {
    return null;
  }
}
