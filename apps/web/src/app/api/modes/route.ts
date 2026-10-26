import { NextResponse } from "next/server";
import { apiError, handleRouteFailure, parsePlace, readJsonBody } from "@/server/api";
import { compareModes } from "@/server/trips";

export const maxDuration = 60;

/** POST /api/modes {from, to} — walk, bike, transit, drive and rideshare compared for one trip. */
export async function POST(request: Request) {
  const body = await readJsonBody(request);
  const from = parsePlace(body?.from);
  const to = parsePlace(body?.to);
  if (!from || !to) return apiError("Both places must be in Georgia.", "invalid", 400);
  try {
    return NextResponse.json(await compareModes(from, to));
  } catch (err) {
    return handleRouteFailure(err);
  }
}
