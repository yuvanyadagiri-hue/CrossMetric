import { NextResponse } from "next/server";
import type { JourneyApiError } from "@/lib/journey-types";
import { readJsonBody } from "@/server/api";
import { parseArriveByRequest, planArrival } from "@/server/arriveby/plan";
import { CommuteDataMissing } from "@/server/commute/data";

export const maxDuration = 60;

const error = (body: JourneyApiError, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * POST /api/arriveby/plan — "I need to be at this building by this time": when to leave,
 * how to go, where you may park with your permit, and a backup. Built on the journey
 * planner (same validation and routing); nothing is stored, and the start is not logged.
 */
export async function POST(request: Request) {
  const now = Date.now();
  const parsed = parseArriveByRequest(await readJsonBody(request), now);
  if (!parsed.ok) return error({ error: parsed.error, kind: "invalid", field: parsed.field }, 400);
  try {
    return NextResponse.json(await planArrival(parsed.value, now), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof CommuteDataMissing) return error({ error: "Campus data or timetables have not been built on this server.", kind: "data_missing" }, 503);
    console.error(err);
    return error({ error: "Your arrival plan couldn't be calculated right now. Try again in a moment.", kind: "unavailable" }, 500);
  }
}
