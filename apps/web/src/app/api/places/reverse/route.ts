import { NextResponse } from "next/server";
import { isGeorgiaPoint } from "@/lib/trip-types";
import { apiError, readJsonBody } from "@/server/api";
import { reverseGeocode } from "@/server/geocode";

/** POST /api/places/reverse {lon, lat} — a short street label for a point (coordinates stay out of URLs and logs). */
export async function POST(request: Request) {
  const body = await readJsonBody(request);
  const lon = Number(body?.lon);
  const lat = Number(body?.lat);
  if (!isGeorgiaPoint(lon, lat)) return apiError("CrossMetric covers locations in Georgia.", "invalid", 400);
  return NextResponse.json({ label: await reverseGeocode(lon, lat) });
}
