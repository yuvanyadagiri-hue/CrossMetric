import { NextResponse } from "next/server";
import { readJsonBody } from "@/server/api";
import { inGeorgia } from "@/server/commute/api";
import { nearbyTransit } from "@/server/journey/nearby";

export const maxDuration = 30;

/**
 * POST /api/transit/nearby {lon, lat, railOnly?, walkSpeedMps?}
 * Stations and stops near a point, ranked by walking time, with scheduled departures
 * (timetable times, never live). The point is sent in the body so it stays out of URLs and logs.
 */
export async function POST(request: Request) {
  const body = await readJsonBody(request);
  const lon = Number(body?.lon);
  const lat = Number(body?.lat);
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || !inGeorgia(lon, lat)) return NextResponse.json({ error: "Choose a place in Georgia.", kind: "invalid" }, { status: 400 });
  const walk = Number(body?.walkSpeedMps);
  try {
    const res = await nearbyTransit([lon, lat], { railOnly: body?.railOnly === true, walkSpeedMps: walk >= 0.5 && walk <= 2.5 ? walk : 1.25 });
    return NextResponse.json(res, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Transit data couldn't be loaded right now.", kind: "unavailable" }, { status: 503 });
  }
}
