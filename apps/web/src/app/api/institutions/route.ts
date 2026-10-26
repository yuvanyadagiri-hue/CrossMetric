import { NextResponse } from "next/server";
import { getInstitutions } from "@/server/institutions";

/** GET /api/institutions — every Georgia public school and degree-granting college CrossMetric analyzes (compact). */
export async function GET() {
  const all = await getInstitutions();
  return NextResponse.json(
    {
      fields: ["id", "type", "name", "city", "level", "lon", "lat", "candidates800", "crashes1200", "aliases"],
      rows: all.map((s) => [s.id, s.type, s.name, s.city, s.level, s.lon, s.lat, s.candidates800, s.crashes1200, s.aliases ?? null]),
    },
    { headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" } },
  );
}
