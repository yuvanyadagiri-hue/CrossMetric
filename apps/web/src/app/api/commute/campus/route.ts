import { NextResponse, type NextRequest } from "next/server";
import { isCampusId } from "@/lib/commute-types";
import { commuteError, handleCommuteFailure } from "@/server/commute/api";
import { getCampus } from "@/server/commute/data";

/** GET /api/commute/campus?id=gt|uga — buildings, entrances, parking places, night services and sources. */
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!isCampusId(id)) return commuteError("Unknown campus.", "invalid", 400);
  try {
    const { bundle } = await getCampus(id);
    return NextResponse.json(bundle, { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=3600" } });
  } catch (err) {
    return handleCommuteFailure(err);
  }
}
