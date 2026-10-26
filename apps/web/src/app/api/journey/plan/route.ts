import { NextResponse } from "next/server";
import type { JourneyApiError } from "@/lib/journey-types";
import { readJsonBody } from "@/server/api";
import { CommuteDataMissing } from "@/server/commute/data";
import { planJourney } from "@/server/journey/plan";
import { parseJourneyRequest } from "@/server/journey/request";

export const maxDuration = 60;

const error = (body: JourneyApiError, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * POST /api/journey/plan — compare ways to travel between two points in Georgia:
 * walking, biking, driving (with verified campus parking where it exists), transit
 * on published timetables, and driving to a MARTA station with parking. Timing is
 * explicit (leave now, depart at, arrive by); the person's hard constraints decide
 * what is eligible and their priority orders the rest. Nothing is stored.
 */
export async function POST(request: Request) {
  const now = Date.now();
  const parsed = parseJourneyRequest(await readJsonBody(request), now);
  if (!parsed.ok) return error({ error: parsed.error, kind: "invalid", field: parsed.field }, 400);
  try {
    const plan = await planJourney(parsed.value, now);
    return NextResponse.json(plan, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof CommuteDataMissing) return error({ error: "Transit timetables have not been built on this server.", kind: "data_missing" }, 503);
    console.error(err);
    return error({ error: "Routes couldn't be calculated right now. Try again in a moment.", kind: "unavailable" }, 500);
  }
}
