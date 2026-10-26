import { NextResponse } from "next/server";
import { apiError, handleRouteFailure, parsePlace, readJsonBody } from "@/server/api";
import { planTrip } from "@/server/trips";

export const maxDuration = 60;

/**
 * POST /api/trips {from, to, mode: "walk" | "bike" | "drive"}
 * Safest, balanced and fastest routes, each with a CrossScore and its evidence.
 */
export async function POST(request: Request) {
  const body = await readJsonBody(request);
  const from = parsePlace(body?.from);
  const to = parsePlace(body?.to);
  const mode = body?.mode;
  if (!from || !to) return apiError("Both places must be in Georgia.", "invalid", 400);
  if (mode !== "walk" && mode !== "bike" && mode !== "drive") return apiError("Mode must be walk, bike or drive.", "invalid", 400);
  if (Math.hypot(from.lon - to.lon, from.lat - to.lat) < 0.0003) return apiError("The start and destination are the same place.", "invalid", 400);
  try {
    return NextResponse.json(await planTrip(from, to, mode));
  } catch (err) {
    return handleRouteFailure(err);
  }
}
