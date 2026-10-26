import { NextResponse } from "next/server";
import { functionalClassLabel } from "@crossmetric/engine";
import { isGeorgiaPoint } from "@/lib/trip-types";
import { apiError, readJsonBody } from "@/server/api";
import { crashesNear, roadAt } from "@/server/route-analysis";
import { getStatewide, settingAt } from "@/server/statewide";
import { getTransit, nearestStops } from "@/server/transit";

const RADIUS_M = 100;

/**
 * POST /api/map/point {lon, lat} — what CrossMetric knows about one spot:
 * the GDOT road there, crashes within 100 m, the area's setting and nearby transit.
 */
export async function POST(request: Request) {
  const body = await readJsonBody(request);
  const lon = Number(body?.lon);
  const lat = Number(body?.lat);
  if (!isGeorgiaPoint(lon, lat)) return apiError("CrossMetric covers locations in Georgia.", "invalid", 400);
  try {
    const sw = await getStatewide();
    const road = roadAt(sw, [lon, lat]);
    const crashes = crashesNear(sw, [lon, lat], RADIUS_M);
    const setting = settingAt(sw, lon, lat);
    const ctx = sw.manifest.references.contexts[setting];
    const transit = await getTransit().catch(() => null);
    const stops = transit ? nearestStops(transit, [lon, lat], 400, 3).map(({ i, d }) => ({ name: transit.stops.name[i]!, rail: transit.stops.rail[i]!, routes: transit.stops.routes[i] ?? [], distanceM: Math.round(d) })) : [];
    // Typical crashes within 100 m in this setting: average density x ~200 m of road through the circle.
    const typical = ctx.mean.all * 0.2;
    return NextResponse.json({
      radiusM: RADIUS_M,
      window: sw.manifest.window,
      road: road ? { functionalClass: road.fSystem, label: functionalClassLabel(road.fSystem), lanes: road.lanes, aadt: road.aadt } : null,
      crashes,
      setting: { id: setting, label: ctx.label, typicalCrashes: Math.round(typical * 10) / 10 },
      stops,
    });
  } catch {
    return apiError("Statewide data is not available on this server.", "data_missing", 503);
  }
}
