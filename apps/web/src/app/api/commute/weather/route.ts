import { NextResponse, type NextRequest } from "next/server";
import { commuteError, inGeorgia } from "@/server/commute/api";
import { weatherFor } from "@/server/commute/weather";

/** GET /api/commute/weather?lat=&lon=[&at=] — rain state for 45 minutes from `at` (default now) plus active NWS alerts. */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const lat = Number(sp.get("lat"));
  const lon = Number(sp.get("lon"));
  if (!inGeorgia(lon, lat)) return commuteError("Location must be in Georgia.", "invalid", 400);
  const atRaw = Number(sp.get("at"));
  const at = Number.isFinite(atRaw) && Math.abs(atRaw - Date.now()) < 7 * 24 * 3600_000 ? atRaw : Date.now();
  const view = await weatherFor(lat, lon, at, at + 45 * 60_000);
  return NextResponse.json(view, { headers: { "Cache-Control": "public, max-age=300" } });
}
