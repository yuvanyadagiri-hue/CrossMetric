import { NextResponse } from "next/server";
import { readJsonBody } from "@/server/api";
import { commuteError, handleCommuteFailure, parsePlanRequest } from "@/server/commute/api";
import { PlanInputError, planCommute } from "@/server/commute/plan";

export const maxDuration = 60;

/**
 * POST /api/commute/plan — arrive-by (or leave-now) options to a campus building entrance:
 * walking, driving to an eligible parking place, transit and park-and-ride.
 * Nothing is stored; the origin is used only to compute this plan.
 */
export async function POST(request: Request) {
  const now = Date.now();
  const parsed = parsePlanRequest(await readJsonBody(request), now);
  if (!parsed.ok) return commuteError(parsed.error, "invalid", 400);
  try {
    const plan = await planCommute(parsed.value, now, parsed.departNow);
    return NextResponse.json(plan, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof PlanInputError) return commuteError(err.message, "invalid", 400);
    return handleCommuteFailure(err);
  }
}
