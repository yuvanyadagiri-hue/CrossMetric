import { NextResponse } from "next/server";
import { apiError, handleRouteFailure, parsePlace, readJsonBody } from "@/server/api";
import { curbOptions } from "@/server/trips";

/** POST /api/curb {place, purpose: "pickup" | "dropoff"} — nearby curb points compared on conditions at the curb. */
export async function POST(request: Request) {
  const body = await readJsonBody(request);
  const place = parsePlace(body?.place);
  const purpose = body?.purpose;
  if (!place) return apiError("The place must be in Georgia.", "invalid", 400);
  if (purpose !== "pickup" && purpose !== "dropoff") return apiError("Purpose must be pickup or dropoff.", "invalid", 400);
  try {
    return NextResponse.json(await curbOptions(place, purpose));
  } catch (err) {
    return handleRouteFailure(err);
  }
}
