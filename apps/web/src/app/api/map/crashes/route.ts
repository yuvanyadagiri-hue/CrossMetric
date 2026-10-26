import { NextResponse, type NextRequest } from "next/server";
import { crashesInBox } from "@/server/route-analysis";
import { getStatewide } from "@/server/statewide";

const MAX_SPAN_DEG = 0.12;
const LIMIT = 8000;

/** GET /api/map/crashes?bbox=w,s,e,n — individual GDOT crash points for a small map area. */
export async function GET(request: NextRequest) {
  const [w, s, e, n] = (request.nextUrl.searchParams.get("bbox") ?? "").split(",").map(Number);
  if (w === undefined || s === undefined || e === undefined || n === undefined || ![w, s, e, n].every(Number.isFinite) || e <= w || n <= s) {
    return NextResponse.json({ error: "bbox=w,s,e,n required" }, { status: 400 });
  }
  if (e - w > MAX_SPAN_DEG || n - s > MAX_SPAN_DEG) return NextResponse.json({ error: "Zoom in to load individual crashes." }, { status: 400 });
  try {
    const sw = await getStatewide();
    const points = crashesInBox(sw, w, s, e, n, LIMIT);
    return NextResponse.json(
      {
        window: sw.manifest.window,
        truncated: points.length >= LIMIT,
        lon: points.map((p) => Math.round(p.lon * 1e5) / 1e5),
        lat: points.map((p) => Math.round(p.lat * 1e5) / 1e5),
        flags: points.map((p) => p.flags),
        day: points.map((p) => p.day),
      },
      { headers: { "cache-control": "public, max-age=3600" } },
    );
  } catch {
    return NextResponse.json({ error: "Crash data has not been built on this server." }, { status: 503 });
  }
}
