import { NextResponse, type NextRequest } from "next/server";
import { validateReport } from "@/lib/reports";
import { apiError, readJsonBody } from "@/server/api";
import { clientAddress, getReportStore, rateLimited } from "@/server/reports";

/** GET /api/reports[?bbox=w,s,e,n] — community reports, newest first. */
export async function GET(request: NextRequest) {
  const all = await getReportStore().list();
  const bbox = (request.nextUrl.searchParams.get("bbox") ?? "").split(",").map(Number);
  const reports =
    bbox.length === 4 && bbox.every(Number.isFinite)
      ? all.filter((r) => r.lon >= bbox[0]! && r.lat >= bbox[1]! && r.lon <= bbox[2]! && r.lat <= bbox[3]!)
      : all;
  return NextResponse.json({ reports }, { headers: { "Cache-Control": "no-store" } });
}

/** POST /api/reports {category, description?, lon, lat, locationLabel?} — add an anonymous community report. */
export async function POST(request: Request) {
  if (rateLimited(clientAddress(request.headers), "create")) {
    return apiError("Too many reports from this connection. Please try again later.", "invalid", 429);
  }
  const parsed = validateReport(await readJsonBody(request));
  if (!parsed.ok) return apiError(parsed.error, "invalid", 400);
  const report = await getReportStore().create(parsed.value);
  return NextResponse.json({ report }, { status: 201 });
}
